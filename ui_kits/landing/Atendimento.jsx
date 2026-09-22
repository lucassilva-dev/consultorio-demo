function Atendimento() {
  const features = [
    { t: 'Online com horário agendado', d: 'Sessões por videochamada com data e hora marcadas, em ambiente reservado.' },
    { t: 'Adolescentes, jovens adultos e adultos', d: 'Atendimento individual, com escuta adequada para cada momento de vida.' },
    { t: 'Ético, sigiloso e acolhedor', d: 'Espaço protegido pelo sigilo profissional, sem julgamento, no seu tempo.' },
  ];
  return (
    <section id="atendimento" className="section section-soft">
      <div className="container" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr)',
        gap: 'clamp(40px, 8vw, 120px)',
        alignItems: 'center',
      }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 16 }}>ATENDIMENTO</div>
          <h2 style={{ marginBottom: 24 }}>
            Atendimento psicológico<br/>
            <em style={{ color: 'var(--accent)' }}>online</em>.
          </h2>
          <p className="lede" style={{ marginBottom: 36, color: 'var(--fg-muted)' }}>
            De qualquer lugar do Brasil. Sem deslocamento, com a continuidade que um processo terapêutico pede.
          </p>
          <a href="#agendar" className="btn btn-primary">Quero agendar uma conversa</a>
        </div>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {features.map((f, i) => (
            <li key={i} style={{
              padding: '28px 0',
              borderBottom: i < features.length - 1 ? '1px solid var(--line)' : 'none',
              display: 'grid',
              gridTemplateColumns: '40px 1fr',
              gap: 20, alignItems: 'start',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                border: '1px solid var(--accent-soft)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-display)', fontStyle: 'italic',
                color: 'var(--accent)', fontSize: 17, marginTop: 2,
              }}>{i + 1}</div>
              <div>
                <h3 style={{ marginBottom: 6 }}>{f.t}</h3>
                <p style={{ color: 'var(--fg-muted)', fontSize: 16, lineHeight: 1.6 }}>{f.d}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
window.Atendimento = Atendimento;
