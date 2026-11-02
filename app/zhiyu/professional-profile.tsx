import type { Person } from './data';

export default function ProfessionalProfile({
  profile,
}: {
  profile: NonNullable<Person['professionalProfile']>;
}) {
  return (
    <section className="zy-professional-profile" aria-label="专业背景">
      <h2>专业背景</h2>
      <strong className="zy-professional-title">{profile.title}</strong>
      <p className="zy-professional-summary">{profile.summary}</p>
      <details className="zy-professional-certificates">
        <summary>专业资质 · 共 {profile.certificates.length} 项</summary>
        <ul>
          {profile.certificates.map(certificate => (
            <li key={certificate.id}>
              <strong>{certificate.name}</strong>
              <span className="zy-professional-certificate-level">{certificate.category} · {certificate.level}</span>
              <p>{certificate.summary}</p>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
