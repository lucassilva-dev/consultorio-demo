function Fechamento() {
  return (
    <section id="agendar" className="section">
      <div className="container-narrow" style={{ textAlign: 'center' }}>
        <h2 style={{
          fontSize: 'clamp(36px, 5.5vw, 60px)',
          marginBottom: 32,
          maxWidth: 720, marginInline: 'auto',
        }}>
          Talvez você não precise dar conta<br/>
          <em style={{ color: 'var(--accent)' }}>de tudo sozinha.</em>
        </h2>
        <p className="lede" style={{ maxWidth: 580, marginInline: 'auto', marginBottom: 44 }}>
          A terapia pode ser um espaço para organizar o que está confuso, nomear o que pesa e construir novas formas de se relacionar consigo e com o mundo.
        </p>
        <a href="#" className="btn btn-primary" style={{ padding: '18px 32px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
          Agendar atendimento pelo WhatsApp
        </a>
      </div>
    </section>
  );
}
window.Fechamento = Fechamento;
