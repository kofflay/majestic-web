export const HR_FORM_TYPES = {
  promotion_report: {
    key: 'promotion_report',
    label: 'Отчёт о повышении',
    numberLabel: 'Отчёт о повышении №',
    sequenceKey: 'lspd:hr-audit:sequence',
    idsKey: 'lspd:hr-audit:ids',
    itemKey: number => `lspd:hr-audit:item:${number}`,
    enabled: true
  },
  department_transfer: {
    key: 'department_transfer',
    label: 'Перевод в отдел',
    numberLabel: 'Перевод в отдел №',
    sequenceKey: 'lspd:hr-forms:sequence:department-transfer',
    idsKey: 'lspd:hr-forms:ids:department-transfer',
    itemKey: number => `lspd:hr-forms:item:department-transfer:${number}`,
    enabled: false
  }
};

export function getHrFormType(type) {
  return HR_FORM_TYPES[type] || null;
}

export function getHrFormDisplayTitle(type, number) {
  const config = getHrFormType(type);
  return config ? `${config.numberLabel}${number}` : `Заявка №${number}`;
}

export function isHrFormStatus(status) {
  return ['pending', 'accepted', 'rejected'].includes(status);
}
