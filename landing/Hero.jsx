function Hero() {
  return (
    <section className="container" style={{
      paddingTop: 'clamp(64px, 9vw, 140px)',
      paddingBottom: 'clamp(64px, 9vw, 140px)',
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
      gap: 'clamp(32px, 6vw, 96px)',
      alignItems: 'center',
    }}>
      <div>
        <div className="eyebrow" style={{ marginBottom: 24 }}>PSICÓLOGA · ATENDIMENTO ONLINE</div>
        <h1 className="display-xl" style={{ marginBottom: 18 }}>
          Marina<br/>
          Alves
        </h1>
        <hr style={{
          border: 0,
          height: 2,
          width: 220,
          background: 'var(--accent-soft)',
          margin: '0 0 28px 0',
          borderRadius: 2,
        }} />
        <p className="lede" style={{ maxWidth: 520, marginBottom: 36 }}>
          Um espaço de escuta para compreender sua história, seus vínculos e os caminhos que se repetem na sua vida.
        </p>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <a href="#agendar" className="btn btn-primary">Agendar atendimento</a>
          <a href="#sobre" className="btn btn-secondary">Conhecer meu trabalho</a>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <div style={{
          width: 'min(420px, 100%)',
          aspectRatio: '1 / 1',
          background: 'var(--bg-soft)',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: 'var(--shadow-1)',
          position: 'relative',
        }}>
          <img src="../assets/portrait-placeholder.svg" alt="Marina Alves"
               style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      </div>
    </section>
  );
}
window.Hero = Hero;
