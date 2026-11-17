import { verifyToken } from '../../../lib/discord';
import { hasHrAuditAccess } from '../../../lib/hr-audit-access';
import { kv } from '../../../lib/redis.js';
import { getDepartment, getReportWebhook } from '../../../lib/departments';
import { acquireHrAuditLock } from '../../../lib/hr-audit-locks';
import { writeSystemLog } from '../../../lib/system-logs';

const AUDIT_IDS_KEY = 'lspd:hr-audit:ids';
const DISCORD_ID_PATTERN = /^\d{17,20}$/;
const AUDIT_ITEM_ID_PATTERN = /^[1-9]\d{0,11}$/;

const SAVE_DECISION_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return -1 end
local current = cjson.decode(raw)
if current.type ~= 'report' and current.type ~= 'highrank' then return -2 end
if current.status ~= 'pending' then return 0 end
if current.deliveryPending ~= false then return -3 end
if tostring(current.id) ~= ARGV[2] then return -2 end
redis.call('SET', KEYS[1], ARGV[1])
return 1
`;

function validItemId(id) {
  return AUDIT_ITEM_ID_PATTERN.test(String(id ?? ''));
}

function historyOf(item) {
  return Array.isArray(item.history) ? item.history : [];
}

function getAuditWebhook(item) {
  if (item?.type === 'highrank') return process.env.WEBHOOK_HIGH_RANK_REPORT || null;
  if (item?.type === 'report') {
    const department = getDepartment(item.data?.department);
    return department ? getReportWebhook(department.id) : null;
  }
  return null;
}

function isSupportedAuditItem(item) {
  return Boolean(item && ['report', 'highrank'].includes(item.type));
}

function webhookUrlWithWait(webhook) {
  const url = new URL(webhook);
  url.searchParams.set('wait', 'true');
  return url.toString();
}

async function sendDecision(item, reviewer, decision, reason) {
  const webhook = getAuditWebhook(item);
  const applicantId = String(item.submitter?.id || '');
  const reviewerId = String(reviewer?.id || '');

  if (!webhook) {
    await writeSystemLog({ level: 'error', category: 'discord', event: 'webhook_not_configured', message: 'Вебхук для уведомления о решении не настроен', auditId: item.id, auditType: item.type, decision });
    return { success: false, messageId: null, reason: 'webhook_not_configured' };
  }
  if (!DISCORD_ID_PATTERN.test(reviewerId)) {
    await writeSystemLog({ level: 'error', category: 'discord', event: 'reviewer_invalid', message: 'Не удалось отправить уведомление: некорректный Discord ID проверяющего', auditId: item.id, auditType: item.type, decision });
    return { success: false, messageId: null, reason: 'reviewer_invalid' };
  }

  const accepted = decision === 'accepted';

  // Approved high-rank reports: update the existing HR card, persist that
  // stage, then publish the separate personnel-audit card.
  if (item.type === 'highrank' && accepted) {
    const auditWebhook = process.env.WEBHOOK_AUDIT_URL || null;

    const reportData = item.data && typeof item.data === 'object' ? item.data : {};
    const fieldValue = (value, fallback = 'Не указано') => {
      const text = typeof value === 'string' ? value.trim() : '';
      return (text || fallback).slice(0, 1024);
    };
    const reviewerName = String(reviewer?.username || 'Неизвестно').slice(0, 256);
    const applicantName = fieldValue(reportData.fullName);
    const rankRange = fieldValue(reportData.rankRange);
    const originalMessageId = String(item.deliveryMessageId || '');
    const reportWebhook = getAuditWebhook(item);

    if (!/^\d{17,20}$/.test(originalMessageId) || !reportWebhook) {
      await writeSystemLog({ level: 'error', category: 'discord', event: 'highrank_source_message_missing', message: 'Нет исходного сообщения HR-отчёта для обновления карточки кадрового аудита', auditId: item.id, auditType: item.type, decision });
      return { success: false, messageId: null, reason: 'highrank_source_message_missing' };
    }

    let reportMessageId = item.approvedReportMessageId || originalMessageId;
    let reportMessageUrl = item.approvedReportMessageUrl || null;

    if (!item.approvedReportSentAt || !reportMessageUrl) {
      const messageUrl = new URL(reportWebhook);
      messageUrl.search = '';
      messageUrl.hash = '';
      messageUrl.pathname = `${messageUrl.pathname.replace(/\/$/, '')}/messages/${originalMessageId}`;

      let sourceMessage;
      let webhookInfo;
      try {
        const [sourceResponse, webhookResponse] = await Promise.all([
          fetch(messageUrl.toString(), { method: 'GET', signal: AbortSignal.timeout(15000) }),
          fetch(reportWebhook, { method: 'GET', signal: AbortSignal.timeout(15000) })
        ]);
        if (!sourceResponse.ok || !webhookResponse.ok) {
          const failed = !sourceResponse.ok ? sourceResponse : webhookResponse;
          const details = (await failed.text()).slice(0, 2000);
          await writeSystemLog({ level: 'error', category: 'discord', event: 'discord_http_error', message: 'Не удалось получить исходную HR-карточку или данные вебхука', auditId: item.id, auditType: item.type, decision, httpStatus: failed.status, details });
          return { success: false, messageId: null, reason: `discord_http_${failed.status}` };
        }
        sourceMessage = await sourceResponse.json();
        webhookInfo = await webhookResponse.json();
      } catch (error) {
        await writeSystemLog({ level: 'error', category: 'discord', event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error', message: 'Не удалось получить исходную HR-карточку', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1200) });
        return { success: false, messageId: null, reason: 'source_message_lookup_failed' };
      }

      const guildId = String(webhookInfo.guild_id || '');
      const channelId = String(sourceMessage.channel_id || webhookInfo.channel_id || '');
      if (!/^\d{17,20}$/.test(guildId) || !/^\d{17,20}$/.test(channelId)) {
        await writeSystemLog({ level: 'error', category: 'discord', event: 'highrank_source_link_unavailable', message: 'Discord не вернул сервер или канал исходной HR-карточки', auditId: item.id, auditType: item.type, decision });
        return { success: false, messageId: null, reason: 'source_link_unavailable' };
      }

      const originalEmbed = Array.isArray(sourceMessage.embeds) ? sourceMessage.embeds[0] || {} : {};
      const profileReportUrl = `[Открыть отчёт в личном кабинете](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/profile?audit=${encodeURIComponent(item.id)})`;
      const updatedEmbed = {
        ...(originalEmbed.url ? { url: originalEmbed.url } : {}),
        ...(originalEmbed.author?.name ? { author: { name: originalEmbed.author.name, ...(originalEmbed.author.url ? { url: originalEmbed.author.url } : {}), ...(originalEmbed.author.icon_url ? { icon_url: originalEmbed.author.icon_url } : {}) } } : {}),
        ...(originalEmbed.image?.url ? { image: { url: originalEmbed.image.url } } : {}),
        ...(originalEmbed.thumbnail?.url ? { thumbnail: { url: originalEmbed.thumbnail.url } } : {}),
        title: `Отчёт на повышение хай-состава №${item.number} — ОДОБРЕНО`,
        color: 0x4CAF50,
        description: profileReportUrl,
        fields: [
          { name: '👤 Имя Фамилия + Статик', value: applicantName, inline: false },
          { name: '📊 Диапазон повышения', value: rankRange, inline: true },
          { name: '🔗 Ссылка на проделанную работу', value: fieldValue(reportData.workLink), inline: false },
          { name: '👤 Отправитель', value: DISCORD_ID_PATTERN.test(applicantId) ? `<@${applicantId}>` : 'Discord ID не указан', inline: true },
          { name: '🆔 Discord ID', value: fieldValue(applicantId, 'Не указан'), inline: true },
          { name: '⚖️ Решение', value: 'Одобрено', inline: true },
          { name: '👮 Проверил', value: `<@${reviewerId}>`, inline: true }
        ],
        footer: { text: 'LSPD HR Audit', ...(originalEmbed.footer?.icon_url ? { icon_url: originalEmbed.footer.icon_url } : {}) },
        timestamp: item.resolvedAt || new Date().toISOString()
      };

      let patchResponse;
      try {
        patchResponse = await fetch(messageUrl.toString(), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `Решение по отчёту на повышение №${item.number} принято: одобрено.`, embeds: [updatedEmbed] }),
          signal: AbortSignal.timeout(15000)
        });
      } catch (error) {
        await writeSystemLog({ level: 'error', category: 'discord', event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error', message: 'Не удалось обновить исходную HR-карточку', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1200) });
        return { success: false, messageId: null, reason: 'hr_card_update_failed' };
      }
      if (!patchResponse.ok) {
        const details = (await patchResponse.text()).slice(0, 2000);
        await writeSystemLog({ level: 'error', category: 'discord', event: 'discord_http_error', message: 'Discord отклонил обновление исходной HR-карточки', auditId: item.id, auditType: item.type, decision, httpStatus: patchResponse.status, details });
        return { success: false, messageId: null, reason: `discord_http_${patchResponse.status}` };
      }

      reportMessageId = originalMessageId;
      reportMessageUrl = `https://discord.com/channels/${guildId}/${channelId}/${originalMessageId}`;
      const stageOneAt = new Date().toISOString();
      const latest = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
      const stageOneSaved = {
        ...(latest || item),
        approvedReportMessageId: reportMessageId,
        approvedReportMessageUrl: reportMessageUrl,
        approvedReportSentAt: stageOneAt,
        history: [...historyOf(latest || item), { action: 'approved_report_updated', at: stageOneAt, userId: 'system' }]
      };
      try {
        await kv.set(`lspd:hr-audit:item:${item.id}`, stageOneSaved);
      } catch (saveError) {
        const persisted = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
        if (persisted?.approvedReportMessageId !== reportMessageId || persisted?.approvedReportMessageUrl !== reportMessageUrl) {
          await writeSystemLog({ level: 'error', category: 'discord', event: 'approved_report_state_save_failed', message: 'Исходная HR-карточка обновлена, но состояние этапа не удалось подтвердить; автоматический повтор остановлен', auditId: item.id, auditType: item.type, decision, details: String(saveError?.message || saveError).slice(0, 1000) });
          return { success: false, messageId: reportMessageId, reason: 'approved_report_state_save_failed' };
        }
      }
    }

    const latestBeforeAudit = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
    if (latestBeforeAudit?.auditMessageId) {
      return { success: true, messageId: latestBeforeAudit.auditMessageId, approvedReportMessageId: reportMessageId, auditMessageId: latestBeforeAudit.auditMessageId };
    }

    if (!auditWebhook) {
      await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_webhook_not_configured', message: 'Не настроен WEBHOOK_AUDIT_URL для кадрового аудита', auditId: item.id, auditType: item.type, decision });
      return { success: false, messageId: reportMessageId, reason: 'audit_webhook_not_configured' };
    }

    const auditEmbed = {
      title: '📑 ОТЧЁТ О ПОВЫШЕНИИ СОТРУДНИКА',
      color: 0x4CAF50,
      fields: [
        { name: '🔗 Причина повышения', value: reportMessageUrl, inline: false },
        { name: '📊 Повышен с ранга', value: rankRange, inline: true },
        { name: '👤 Повышен', value: `<@${applicantId}>`, inline: true },
        { name: 'Имя Фамилия + Статик', value: applicantName, inline: false },
        { name: '🆔 Discord ID', value: DISCORD_ID_PATTERN.test(applicantId) ? applicantId : 'Не указан', inline: true },
        { name: '👮 Повышает', value: `<@${reviewerId}>`, inline: true },
        { name: 'Имя Фамилия проверяющего', value: reviewerName, inline: false },
        { name: '🆔 Discord ID проверяющего', value: reviewerId, inline: true },
        { name: '📅 Дата повышения', value: new Date(item.resolvedAt || Date.now()).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }), inline: true }
      ],
      timestamp: item.resolvedAt || new Date().toISOString(),
      footer: { text: `HR Audit • Заявка №${item.number}` }
    };

    // Brief pause after the HR card update before publishing the personnel audit.
    await new Promise(resolve => setTimeout(resolve, 2000));

    let auditResponse;
    try {
      auditResponse = await fetch(webhookUrlWithWait(auditWebhook), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'LSPD Forms',
          content: `<@${reviewerId}> повышает <@${applicantId}>`,
          embeds: [auditEmbed]
        }),
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      await writeSystemLog({ level: 'error', category: 'discord', event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error', message: 'Не удалось отправить карточку во второй канал кадрового аудита', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1200) });
      return { success: false, messageId: reportMessageId, reason: 'audit_delivery_failed' };
    }
    if (!auditResponse.ok) {
      const details = (await auditResponse.text()).slice(0, 2000);
      await writeSystemLog({ level: 'error', category: 'discord', event: 'discord_http_error', message: 'Discord отклонил публикацию карточки в кадровый аудит', auditId: item.id, auditType: item.type, decision, httpStatus: auditResponse.status, details });
      return { success: false, messageId: reportMessageId, reason: `audit_http_${auditResponse.status}` };
    }

    let auditMessage = null;
    try { auditMessage = await auditResponse.json(); } catch {}
    const auditMessageId = String(auditMessage?.id || '');
    if (!/^\d{17,20}$/.test(auditMessageId)) {
      await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_message_metadata_missing', message: 'Discord принял карточку кадрового аудита, но не вернул ID сообщения', auditId: item.id, auditType: item.type, decision });
      return { success: false, messageId: reportMessageId, reason: 'audit_message_metadata_missing' };
    }
    const stageTwoAt = new Date().toISOString();
    const latestAfterAudit = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
    try {
      await kv.set(`lspd:hr-audit:item:${item.id}`, {
        ...(latestAfterAudit || item),
        auditMessageId,
        auditSentAt: stageTwoAt,
        history: [...historyOf(latestAfterAudit || item), { action: 'personnel_audit_sent', at: stageTwoAt, userId: 'system' }]
      });
    } catch (saveError) {
      const persisted = await kv.get(`lspd:hr-audit:item:${item.id}`).catch(() => null);
      if (persisted?.auditMessageId !== auditMessageId) {
        await writeSystemLog({ level: 'error', category: 'discord', event: 'audit_state_save_failed', message: 'Карточка кадрового аудита отправлена, но ID не удалось подтвердить в реестре; перед повтором проверьте канал', auditId: item.id, auditType: item.type, decision, details: String(saveError?.message || saveError).slice(0, 1000) });
        return { success: false, messageId: reportMessageId, reason: 'audit_state_save_failed' };
      }
    }

    await writeSystemLog({ level: 'info', category: 'discord', event: 'highrank_audit_report_sent', message: 'HR-карточка обновлена, карточка кадрового аудита отправлена', auditId: item.id, auditType: item.type, decision });
    return { success: true, messageId: auditMessageId, approvedReportMessageId: reportMessageId, auditMessageId };
  }
  const profileReportUrl = `[Открыть отчёт в личном кабинете](${(process.env.NEXT_PUBLIC_SITE_URL || 'https://suspect-famq.ru').replace(/\/$/, '')}/profile?audit=${encodeURIComponent(item.id)})`;

  // Для отчётов на повышение хай-состава обновляем исходную карточку,
  // отправленную тем же вебхуком. Остальные типы заявок сохраняют прежний POST-процесс.
  if (item.type === 'highrank') {
    const originalMessageId = String(item.deliveryMessageId || '');
    if (!/^\d{17,20}$/.test(originalMessageId)) {
      await writeSystemLog({
        level: 'error', category: 'discord', event: 'original_message_id_missing',
        message: 'Нельзя обновить карточку HR-заявки: отсутствует ID исходного сообщения',
        auditId: item.id, auditType: item.type, decision
      });
      return { success: false, messageId: null, reason: 'original_message_id_missing' };
    }

    const messageUrl = new URL(webhook);
    messageUrl.search = '';
    messageUrl.hash = '';
    messageUrl.pathname = `${messageUrl.pathname.replace(/\/$/, '')}/messages/${originalMessageId}`;

    let response;
    try {
      response = await fetch(messageUrl.toString(), {
        method: 'GET',
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) {
        const responseBody = (await response.text()).slice(0, 2000);
        await writeSystemLog({
          level: 'error', category: 'discord', event: 'discord_http_error',
          message: 'Не удалось получить исходную карточку HR-заявки из Discord',
          auditId: item.id, auditType: item.type, decision,
          httpStatus: response.status, details: responseBody
        });
        return { success: false, messageId: null, reason: `discord_http_${response.status}` };
      }

      const originalMessage = await response.json();
      const embeds = Array.isArray(originalMessage.embeds) ? originalMessage.embeds : [];
      const originalEmbed = embeds[0] || {};
      const reportData = item.data && typeof item.data === 'object' ? item.data : {};
      const fieldValue = (value, fallback = 'Не указано') => {
        const text = typeof value === 'string' ? value.trim() : '';
        return (text || fallback).slice(0, 1024);
      };
      // Rebuild the high-rank card from the submitted form data, not from
      // the old Discord embed, so every submitted field remains visible.
      const decisionFields = [
        { name: '👤 Имя Фамилия + Статик', value: fieldValue(reportData.fullName), inline: false },
        { name: '📊 Диапазон повышения', value: fieldValue(reportData.rankRange), inline: true },
        { name: '🔗 Ссылка на проделанную работу', value: fieldValue(reportData.workLink), inline: false },
        {
          name: '👤 Отправитель',
          value: DISCORD_ID_PATTERN.test(applicantId) ? `<@${applicantId}>` : 'Discord ID не указан',
          inline: true
        },
        { name: '🆔 Discord ID', value: fieldValue(applicantId, 'Не указан'), inline: true },
        { name: '⚖️ Решение', value: accepted ? 'Одобрено' : 'Отклонено', inline: true },
        { name: '👮 Проверил', value: `<@${reviewerId}>`, inline: true },
        ...(!accepted && reason
          ? [{ name: '❌ Причина отказа', value: fieldValue(reason), inline: false }]
          : [])
      ];
      const updatedEmbed = {
        ...(originalEmbed.url ? { url: originalEmbed.url } : {}),
        ...(originalEmbed.author?.name ? {
          author: {
            name: originalEmbed.author.name,
            ...(originalEmbed.author.url ? { url: originalEmbed.author.url } : {}),
            ...(originalEmbed.author.icon_url ? { icon_url: originalEmbed.author.icon_url } : {})
          }
        } : {}),
        ...(originalEmbed.image?.url ? { image: { url: originalEmbed.image.url } } : {}),
        ...(originalEmbed.thumbnail?.url ? { thumbnail: { url: originalEmbed.thumbnail.url } } : {}),
        title: `Отчёт на повышение хай-состава №${item.number} — ${accepted ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'}`,
        color: accepted ? 0x4CAF50 : 0xDC3545,
        description: profileReportUrl,
        fields: decisionFields,
        footer: {
          text: 'LSPD HR Audit',
          ...(originalEmbed.footer?.icon_url ? { icon_url: originalEmbed.footer.icon_url } : {})
        },
        timestamp: new Date().toISOString()
      };

      const content = `Решение по отчёту на повышение №${item.number} принято: ${accepted ? 'одобрено' : 'отклонено'}.`;
      response = await fetch(messageUrl.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          embeds: [updatedEmbed]
        }),
        signal: AbortSignal.timeout(15000)
      });
    } catch (error) {
      console.error('HR audit Discord original message update failed:', {
        auditId: String(item.id), auditType: item.type, decision,
        errorName: error?.name || 'Error',
        errorMessage: String(error?.message || error).slice(0, 500)
      });
      await writeSystemLog({
        level: 'error', category: 'discord',
        event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error',
        message: 'Не удалось обновить исходную карточку HR-заявки в Discord',
        auditId: item.id, auditType: item.type, decision,
        details: String(error?.message || error).slice(0, 1200)
      });
      return { success: false, messageId: null, reason: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error' };
    }

    if (!response.ok) {
      let responseBody = '';
      try { responseBody = (await response.text()).slice(0, 2000); } catch {}
      console.error('HR audit Discord rejected original message update:', {
        auditId: String(item.id), auditType: item.type, decision,
        httpStatus: response.status, responseBody
      });
      await writeSystemLog({
        level: 'error', category: 'discord', event: 'discord_http_error',
        message: 'Discord отклонил обновление исходной карточки HR-заявки',
        auditId: item.id, auditType: item.type, decision,
        httpStatus: response.status, details: responseBody
      });
      return { success: false, messageId: null, reason: `discord_http_${response.status}` };
    }

    // Для highrank обновляем только исходную карточку; отдельное сообщение-пинг не отправляем.
    return { success: true, messageId: originalMessageId };
  }

  const fields = [
    {
      name: 'Заявитель',
      value: DISCORD_ID_PATTERN.test(applicantId) ? `<@${applicantId}>` : 'Discord ID не указан',
      inline: true
    },
    { name: 'Рассмотрел', value: `<@${reviewerId}>`, inline: true },
    ...(reason ? [{ name: 'Причина отказа', value: reason, inline: false }] : [])
  ];
  const content = [
    DISCORD_ID_PATTERN.test(applicantId) ? `<@${applicantId}>` : null,
    `<@${reviewerId}>`
  ].filter(Boolean).join(' ');

  let response;
  try {
    response = await fetch(webhookUrlWithWait(webhook), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'LSPD Forms',
        content,
        embeds: [{
          title: `Отчёт на повышение №${item.number} — ${accepted ? 'ОДОБРЕНО' : 'ОТКЛОНЕНО'}`,
          color: accepted ? 0x4CAF50 : 0xDC3545,
          description: auditUrl,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: 'LSPD HR Audit' }
        }],
        allowed_mentions: {
          users: [applicantId, reviewerId].filter(value => DISCORD_ID_PATTERN.test(value))
        }
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    console.error('HR audit Discord decision request failed:', {
      auditId: String(item.id), auditType: item.type, decision,
      errorName: error?.name || 'Error',
      errorMessage: String(error?.message || error).slice(0, 500)
    });
    await writeSystemLog({ level: 'error', category: 'discord', event: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error', message: 'Не удалось установить соединение с Discord при отправке уведомления', auditId: item.id, auditType: item.type, decision, details: String(error?.message || error).slice(0, 1200) });
    return { success: false, messageId: null, reason: error?.name === 'TimeoutError' ? 'discord_timeout' : 'discord_network_error' };
  }

  if (!response.ok) {
    let responseBody = '';
    try { responseBody = (await response.text()).slice(0, 2000); } catch {}
    console.error('HR audit Discord rejected decision notification:', {
      auditId: String(item.id), auditType: item.type, decision,
      httpStatus: response.status, responseBody
    });
    await writeSystemLog({ level: 'error', category: 'discord', event: 'discord_http_error', message: 'Discord отклонил уведомление о решении', auditId: item.id, auditType: item.type, decision, httpStatus: response.status, details: responseBody });
    return { success: false, messageId: null, reason: `discord_http_${response.status}` };
  }
  let message = null;
  try { message = await response.json(); } catch {}
  await writeSystemLog({ level: 'info', category: 'discord', event: 'decision_notification_sent', message: 'Уведомление о решении успешно отправлено в Discord', auditId: item.id, auditType: item.type, decision, httpStatus: response.status });
  return { success: true, messageId: typeof message?.id === 'string' ? message.id : null };
}
async function recordNotificationAttempt(itemKey, item, userId, action) {
  const at = new Date().toISOString();
  const attempted = {
    ...item,
    notificationAttempts: (Number.isSafeInteger(item.notificationAttempts) ? item.notificationAttempts : 0) + 1,
    lastNotificationAttemptAt: at,
    history: [...historyOf(item), { action, at, userId: String(userId) }]
  };
  await kv.set(itemKey, attempted);
  return attempted;
}

async function recordDeliveryAttempt(itemKey, item, userId, action) {
  const at = new Date().toISOString();
  const attempted = {
    ...item,
    deliveryAttempts: (Number.isSafeInteger(item.deliveryAttempts) ? item.deliveryAttempts : 0) + 1,
    lastDeliveryAttemptAt: at,
    history: [...historyOf(item), { action, at, userId: String(userId) }]
  };
  await kv.set(itemKey, attempted);
  return attempted;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = verifyToken(req.cookies?.token);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  if (!hasHrAuditAccess(user)) {
    return res.status(403).json({ error: 'Доступ разрешён только уполномоченному проверяющему' });
  }

  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate');

  if (req.method === 'GET') {
    try {
      const ids = await kv.lrange(AUDIT_IDS_KEY, 0, -1);
      const safeIds = Array.isArray(ids) ? ids.filter(validItemId) : [];
      const items = await Promise.all(safeIds.map(id => kv.get(`lspd:hr-audit:item:${id}`)));
      return res.status(200).json({
        items: items.filter(isSupportedAuditItem)
      });
    } catch (error) {
      console.error('HR audit list failed:', error);
      return res.status(500).json({ error: 'Не удалось загрузить кадровый реестр' });
    }
  }

  const { id, decision, reason, action } = req.body || {};
  if (!validItemId(id)) {
    return res.status(400).json({ error: 'Некорректный номер заявки' });
  }
  const itemKey = `lspd:hr-audit:item:${id}`;

  if (action === 'retry-notification') {
    let lock;
    try {
      lock = await acquireHrAuditLock('notification', id);
      if (!lock) {
        return res.status(409).json({ error: 'Уведомление уже обрабатывается. Обновите список позже.' });
      }

      const item = await kv.get(itemKey);
      if (!item || !isSupportedAuditItem(item) || String(item.id) !== String(id)) {
        return res.status(404).json({ error: 'Заявка не найдена' });
      }
      if (!['accepted', 'rejected'].includes(item.status) || item.notificationPending !== true) {
        return res.status(409).json({ error: 'Для этой заявки нет ожидающего уведомления' });
      }
      if (!item.reviewer || !DISCORD_ID_PATTERN.test(String(item.reviewer.id || ''))) {
        return res.status(409).json({ error: 'В записи отсутствуют данные проверяющего; уведомление нельзя безопасно повторить' });
      }
      if (!getAuditWebhook(item)) {
        return res.status(503).json({ error: 'Вебхук для этой категории заявки не настроен. Решение сохранено; повтор уведомления пока недоступен.' });
      }

      const attempted = await recordNotificationAttempt(
        itemKey, item, user.id, 'notification_retry_attempted'
      );
      let result = { success: false, messageId: null };
      try {
        result = await sendDecision(attempted, attempted.reviewer, attempted.status, attempted.reason || '');
      } catch (error) {
        console.error('HR audit Discord notification retry failed:', {
          auditId: String(attempted.id), auditType: attempted.type, decision: attempted.status,
          errorName: error?.name || 'Error',
          errorMessage: String(error?.message || error).slice(0, 500)
        });
      }

      const at = new Date().toISOString();
      const latestAfterSend = await kv.get(itemKey).catch(() => null);
      const stateAfterSend = latestAfterSend || attempted;
      const updated = {
        ...stateAfterSend,
        notificationPending: !result.success,
        ...(result.success ? {
          notificationSentAt: at,
          notificationMessageId: result.messageId || attempted.notificationMessageId || null
        } : {}),
        history: [...historyOf(stateAfterSend), {
          action: result.success ? 'notification_sent' : 'notification_retry_failed',
          at,
          userId: String(user.id)
        }]
      };

      try {
        await kv.set(itemKey, updated);
      } catch (saveError) {
        console.error('HR audit notification result could not be saved:', saveError);
        const persisted = await kv.get(itemKey).catch(() => null);
        const persistedResult = persisted
          && persisted.status === attempted.status
          && persisted.resolvedAt === attempted.resolvedAt
          && persisted.notificationPending === false
          && persisted.notificationSentAt === at
          && historyOf(persisted).some(entry => entry.action === 'notification_sent' && entry.at === at);
        if (persistedResult) {
          return res.status(200).json({
            success: true,
            item: persisted,
            notificationPending: false
          });
        }
        if (result.success) {
          return res.status(200).json({
            success: true,
            item: attempted,
            notificationPending: true,
            warning: 'Discord подтвердил отправку, но реестр не подтвердил обновление. Перед повторной отправкой проверьте канал отдела.'
          });
        }
        throw saveError;
      }

      if (!result.success) {
        return res.status(502).json({ error: 'Discord не подтвердил ответ. Перед повтором проверьте канал отдела: сообщение могло быть принято.' });
      }
      return res.status(200).json({ success: true, item: updated, notificationPending: false });
    } catch (error) {
      console.error('HR audit notification retry failed:', error);
      return res.status(500).json({ error: 'Не удалось повторить уведомление' });
    } finally {
      await lock?.release();
    }
  }

  if (action === 'retry-delivery') {
    let lock;
    try {
      lock = await acquireHrAuditLock('delivery', id);
      if (!lock) {
        return res.status(409).json({ error: 'Отправка уже выполняется. Обновите список позже.' });
      }

      const item = await kv.get(itemKey);
      if (!item || !isSupportedAuditItem(item) || String(item.id) !== String(id)) {
        return res.status(404).json({ error: 'Заявка не найдена' });
      }
      if (item.status !== 'pending' || item.deliveryPending !== true || !item.discordPayload) {
        return res.status(409).json({ error: 'Для этой заявки нет ожидающей доставки' });
      }

      const webhook = getAuditWebhook(item);
      if (!webhook) return res.status(503).json({ error: 'Вебхук для этой категории заявки не настроен' });

      const attempted = await recordDeliveryAttempt(
        itemKey, item, user.id, 'delivery_retry_attempted'
      );
      let response;
      try {
        const retryPayload = { ...attempted.discordPayload };
        const retryUrl = new URL(webhook);
        if (retryPayload.thread_id) {
          retryUrl.searchParams.set('thread_id', String(retryPayload.thread_id));
          delete retryPayload.thread_id;
        }
        retryUrl.searchParams.set('wait', 'true');
        response = await fetch(retryUrl.toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(retryPayload),
          signal: AbortSignal.timeout(15000)
        });
      } catch (deliveryError) {
        console.error('HR audit delivery retry could not be confirmed:', deliveryError);
        const at = new Date().toISOString();
        const updated = {
          ...attempted,
          history: [...historyOf(attempted), {
            action: 'delivery_retry_unconfirmed',
            at,
            userId: String(user.id)
          }]
        };
        await kv.set(itemKey, updated).catch(saveError => {
          console.error('HR audit uncertain delivery history could not be saved:', saveError);
        });
        return res.status(502).json({
          error: 'Не удалось подтвердить ответ Discord. Перед повтором проверьте канал отдела: сообщение могло быть принято.'
        });
      }

      if (!response.ok) {
        const at = new Date().toISOString();
        const updated = {
          ...attempted,
          history: [...historyOf(attempted), {
            action: 'delivery_retry_failed',
            at,
            userId: String(user.id)
          }]
        };
        await kv.set(itemKey, updated);
        return res.status(502).json({ error: 'Discord не принял сообщение. Можно повторить позже.' });
      }

      let message = null;
      try { message = await response.json(); } catch {}
      const deliveredAt = new Date().toISOString();
      const updated = {
        ...attempted,
        deliveryPending: false,
        discordPayload: null,
        deliveredAt,
        deliveryMessageId: typeof message?.id === 'string' ? message.id : null,
        history: [...historyOf(attempted), {
          action: 'delivered',
          at: deliveredAt,
          userId: String(user.id)
        }]
      };

      try {
        await kv.set(itemKey, updated);
      } catch (saveError) {
        console.error('Discord accepted the HR audit delivery but Redis state update failed:', saveError);
        const persisted = await kv.get(itemKey).catch(() => null);
        if (persisted?.deliveryPending === false && persisted.deliveredAt === deliveredAt) {
          return res.status(200).json({ success: true, item: persisted });
        }
        return res.status(200).json({
          success: true,
          item: attempted,
          warning: 'Discord подтвердил отправку, но реестр не подтвердил обновление. Перед повторной отправкой проверьте канал отдела.'
        });
      }
      return res.status(200).json({ success: true, item: updated });
    } catch (error) {
      console.error('HR audit delivery retry failed:', error);
      return res.status(500).json({ error: 'Не удалось повторить отправку' });
    } finally {
      await lock?.release();
    }
  }

  if (!['accepted', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Некорректное решение' });
  }
  const cleanReason = decision === 'rejected' && typeof reason === 'string' ? reason.trim() : '';
  if (decision === 'rejected' && !cleanReason) {
    return res.status(400).json({ error: 'Для отказа обязательно укажите причину' });
  }
  if (decision === 'rejected' && cleanReason.length > 1000) {
    return res.status(400).json({ error: 'Причина слишком длинная' });
  }

  let lock;
  try {
    lock = await acquireHrAuditLock('notification', id);
    if (!lock) {
      return res.status(409).json({ error: 'Уведомление по этой заявке уже обрабатывается. Обновите список позже.' });
    }

    const item = await kv.get(itemKey);
    if (!item || !isSupportedAuditItem(item) || String(item.id) !== String(id)) {
      return res.status(404).json({ error: 'Заявка не найдена' });
    }
    if (item.status !== 'pending') {
      return res.status(409).json({ error: 'По этой заявке уже принято решение' });
    }
    if (item.deliveryPending === true) {
      return res.status(409).json({ error: 'Сначала необходимо подтвердить доставку заявки в Discord' });
    }

    const resolvedAt = new Date().toISOString();
    const notificationAttemptAt = new Date().toISOString();
    const decisionRecord = {
      ...item,
      status: decision,
      reason: decision === 'rejected' ? cleanReason : null,
      reviewer: { id: String(user.id), username: user.username || 'Unknown' },
      resolvedAt,
      notificationPending: true,
      history: [
        ...historyOf(item),
        {
          action: decision,
          at: resolvedAt,
          userId: String(user.id),
          reason: decision === 'rejected' ? cleanReason : null
        },
        {
          action: 'notification_attempted',
          at: notificationAttemptAt,
          userId: String(user.id)
        }
      ]
    };

    // Persist the irreversible decision before contacting Discord.
    let saved;
    try {
      saved = await kv.eval(
        SAVE_DECISION_SCRIPT,
        [itemKey],
        [JSON.stringify(decisionRecord), String(id)]
      );
    } catch (commitError) {
      // Redis may have committed the script even when the client lost its reply.
      const persisted = await kv.get(itemKey).catch(() => null);
      const decisionWasCommitted = persisted
        && isSupportedAuditItem(persisted)
        && persisted.status === decision
        && persisted.resolvedAt === resolvedAt
        && String(persisted.reviewer?.id || '') === String(user.id);
      if (!decisionWasCommitted) throw commitError;
      saved = 1;
    }
    if (saved === -1) return res.status(404).json({ error: 'Заявка не найдена' });
    if (saved === -2) return res.status(404).json({ error: 'Запись кадрового аудита повреждена или не является поддерживаемой заявкой' });
    if (saved === -3) return res.status(409).json({ error: 'Сначала необходимо подтвердить доставку заявки в Discord' });
    if (saved !== 1) return res.status(409).json({ error: 'По этой заявке уже принято решение' });

    let result = { success: false, messageId: null };
    try {
      result = await sendDecision(decisionRecord, decisionRecord.reviewer, decision, cleanReason);
    } catch (error) {
      console.error('HR audit Discord notification failed:', {
        auditId: String(decisionRecord.id), auditType: decisionRecord.type, decision,
        errorName: error?.name || 'Error',
        errorMessage: String(error?.message || error).slice(0, 500)
      });
    }

    const notificationAt = new Date().toISOString();
    const latestAfterSend = await kv.get(itemKey).catch(() => null);
    const stateAfterSend = latestAfterSend || decisionRecord;
    const updated = {
      ...stateAfterSend,
      notificationPending: !result.success,
      ...(result.success ? {
        notificationSentAt: notificationAt,
        notificationMessageId: result.messageId
      } : {}),
      history: [...historyOf(stateAfterSend), {
        action: result.success ? 'notification_sent' : 'notification_pending',
        at: notificationAt,
        userId: String(user.id)
      }]
    };

    try {
      await kv.set(itemKey, updated);
    } catch (saveError) {
      console.error('HR audit decision was saved but notification state update failed:', saveError);
      const persisted = await kv.get(itemKey).catch(() => null);
      const finalAction = result.success ? 'notification_sent' : 'notification_pending';
      const persistedFinalState = persisted
        && persisted.status === decision
        && persisted.resolvedAt === resolvedAt
        && persisted.notificationPending === !result.success
        && historyOf(persisted).some(entry => entry.action === finalAction && entry.at === notificationAt);
      if (persistedFinalState) {
        return res.status(200).json({
          success: true,
          item: persisted,
          notificationPending: !result.success,
          ...(!result.success ? {
            warning: 'Решение сохранено, но Discord не подтвердил уведомление. Перед повторной отправкой проверьте канал отдела: сообщение могло быть принято.'
          } : {})
        });
      }
      return res.status(200).json({
        success: true,
        item: decisionRecord,
        notificationPending: true,
        warning: 'Решение сохранено. Состояние уведомления не удалось подтвердить; перед повторной отправкой проверьте канал отдела.'
      });
    }

    return res.status(200).json({
      success: true,
      item: updated,
      notificationPending: !result.success,
      ...(!result.success ? {
        warning: result.reason === 'webhook_not_configured'
          ? 'Решение сохранено, но вебхук для этой категории заявки не настроен. После настройки его можно будет отправить повторно.'
          : 'Решение сохранено, но Discord не подтвердил уведомление. Перед повторной отправкой проверьте канал отдела: сообщение могло быть принято.'
      } : {})
    });
  } catch (error) {
    console.error('HR audit decision failed:', error);
    return res.status(500).json({ error: 'Не удалось сохранить решение' });
  } finally {
    await lock?.release();
  }
}
