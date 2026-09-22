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
          <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Alves</span>
        </h1>
        <img src="../../assets/underline.svg" alt=""
             style={{ width: 220, marginBottom: 28, opacity: .9 }} />
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
          aspectRatio: '3 / 4',
          background: 'var(--bg-soft)',
          borderRadius: '50% 50% 8px 8px / 36% 36% 4% 4%',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-1)',
          position: 'relative',
        }}>
          <img src="../../assets/portrait-placeholder.svg" alt="Marina Alves"
               style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      </div>
    </section>
  );
}
window.Hero = Hero;
