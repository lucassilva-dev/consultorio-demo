function Forma() {
  const pillars = [
    { n: '01', t: 'História', d: 'O que você traz e o que ainda pede para ser nomeado, organizado, compreendido.' },
    { n: '02', t: 'Relações', d: 'Os vínculos que te formaram e os que você constrói hoje — em casa, no afeto, no trabalho.' },
    { n: '03', t: 'Sentidos e possibilidades', d: 'Os caminhos possíveis a partir do que você passou a enxergar com mais clareza.' },
  ];
  return (
    <section className="section">
      <div className="container">
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 'clamp(40px, 8vw, 120px)',
          alignItems: 'start',
          marginBottom: 80,
        }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 16 }}>MINHA FORMA DE TRABALHO</div>
            <h2>Olhar para o sintoma <em style={{ color: 'var(--accent)' }}>e</em> para o contexto.</h2>
          </div>
          <div>
            <p style={{ fontSize: 18, lineHeight: 1.7, color: 'var(--fg)', marginBottom: 18 }}>
              A terapia não olha apenas para um sintoma isolado. Ela considera sua história, suas relações, os lugares que você ocupa e os padrões que podem estar se repetindo.
            </p>
            <p style={{ fontSize: 18, lineHeight: 1.7, color: 'var(--fg-muted)' }}>
              A partir disso, construímos juntas um processo de compreensão, cuidado e mudança possível.
            </p>
          </div>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 1,
          background: 'var(--line)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}>
          {pillars.map((p, i) => (
            <div key={i} style={{
              background: 'var(--bg)',
              padding: '40px 36px',
            }}>
              <div className="eyebrow" style={{ color: 'var(--accent)', marginBottom: 20 }}>{p.n}</div>
              <h3 style={{
                fontFamily: 'var(--font-display)', fontWeight: 500,
                fontSize: 32, marginBottom: 12, letterSpacing: '-0.01em',
              }}>{p.t}</h3>
              <p style={{ color: 'var(--fg-muted)', fontSize: 16, lineHeight: 1.65 }}>{p.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
window.Forma = Forma;
