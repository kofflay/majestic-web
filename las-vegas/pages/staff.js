// pages/staff.js
import { useState, useEffect } from 'react';
import Header from '../components/Header';
import StaffCard from '../components/StaffCard';

export default function StaffPage() {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/las-vegas/api/staff')
      .then(res => res.json())
      .then(data => {
        setStaff(data);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="site-page-shell staff-page">
        <Header user={null} />
        <main className="staff-page__loading">
          <span className="form-loading__spinner" />
          <span>ЗАГРУЗКА СОСТАВА</span>
        </main>
      </div>
    );
  }

  return (
    <div className="site-page-shell staff-page">
      <Header user={null} />
      <main className="staff-page__content">
        <div className="staff-heading">
          <span className="staff-heading__eyebrow">FEDERAL BUREAU OF INVESTIGATION / LEADERSHIP</span>
          <h1>Руководство</h1>
          <p>Руководящий состав Федерального бюро расследований.</p>
        </div>
        <div className="staff-grid">
          {staff.length > 0 ? (
            staff.map(member => (
              <StaffCard key={member.id} member={member} isAdminView={false} />
            ))
          ) : (
            <div className="staff-empty">Состав руководства пока не опубликован.</div>
          )}
        </div>
      </main>
    </div>
  );
}
