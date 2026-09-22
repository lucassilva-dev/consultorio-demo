function ServiceIcon({ name }) {
  const props = {
    width: 28, height: 28, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.5,
    strokeLinecap: 'round', strokeLinejoin: 'round',
  };
  if (name === 'wind') return <svg {...props}><path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/></svg>;
  if (name === 'users') return <svg {...props}><path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/></svg>;
  if (name === 'circle-dot') return <svg {...props}><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>;
  if (name === 'flower') return <svg {...props}><path d="M12 16c1.5 0 4-1 4-4 0 0-1.7-1-3-1-1.5 0-3 1-3 3 0 1 1 2 2 2Z"/><path d="M12 16c-1.5 0-4-1-4-4 0 0 1.7-1 3-1 1.5 0 3 1 3 3 0 1-1 2-2 2Z"/><path d="M12 8c0-2 2-4 4-4 0 1.5-1 4-3 4"/><path d="M12 8c0-2-2-4-4-4 0 1.5 1 4 3 4"/><path d="M12 16v6"/></svg>;
  if (name === 'compass') return <svg {...props}><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/></svg>;
  if (name === 'sun') return <svg {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>;
  return null;
}

function Servicos() {
  const items = [
    { i: 'wind',       t: 'Ansiedade e sobrecarga emocional', d: 'Para os momentos em que tudo parece pesar ao mesmo tempo e o corpo pede uma pausa.' },
    { i: 'users',      t: 'Relacionamentos e vínculos',       d: 'Para olhar como você ama, escolhe e se posiciona com as pessoas ao seu redor.' },
    { i: 'circle-dot', t: 'Autoestima e autoconhecimento',    d: 'Para entender de onde vêm suas escolhas e construir uma relação mais inteira consigo.' },
    { i: 'flower',     t: 'Sexualidade e saúde emocional da mulher', d: 'Um espaço para falar do que costuma ficar em silêncio, sem julgamento.' },
    { i: 'compass',    t: 'Transições de vida e escolhas difíceis', d: 'Para travessias — fim de ciclo, mudança, decisão — que pedem um lugar de pensar.' },
    { i: 'sun',        t: 'Adolescência e juventude',         d: 'Acompanhamento para quem está construindo identidade, vínculos e direção.' },
  ];
  return (
    <section id="servicos" className="section section-soft">
      <div className="container">
        <div style={{ maxWidth: 720, marginBottom: 64 }}>
          <div className="eyebrow" style={{ marginBottom: 16 }}>COMO POSSO TE AJUDAR</div>
          <h2>Temas que costumamos caminhar juntas.</h2>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 24,
        }}>
          {items.map((s, idx) => (
            <article key={idx} className="card">
              <div style={{ color: 'var(--accent)', marginBottom: 24 }}><ServiceIcon name={s.i} /></div>
              <h3 style={{ marginBottom: 10 }}>{s.t}</h3>
              <p style={{ color: 'var(--fg-muted)', fontSize: 15.5, lineHeight: 1.6 }}>{s.d}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
window.Servicos = Servicos;
