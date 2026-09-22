function Header() {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 10,
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      background: 'rgba(246, 239, 231, 0.78)',
      borderBottom: '1px solid var(--line)',
    }}>
      <div className="container" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBlock: 18,
      }}>
        <a href="#" style={{ display: 'flex', flexDirection: 'column', gap: 4, lineHeight: 1.05, whiteSpace: 'nowrap' }}>
          <span style={{
            fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 24,
            letterSpacing: '-0.01em', color: 'var(--fg)', whiteSpace: 'nowrap',
          }}>Marina Alves</span>
          <span className="eyebrow" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>PSICÓLOGA · CRP [CRP]</span>
        </a>
        <nav style={{ display: 'flex', gap: 32, alignItems: 'center' }}>
          <a href="#sobre" style={{ fontSize: 15, color: 'var(--fg)' }}>Sobre</a>
          <a href="#servicos" style={{ fontSize: 15, color: 'var(--fg)' }}>Como posso te ajudar</a>
          <a href="#atendimento" style={{ fontSize: 15, color: 'var(--fg)' }}>Atendimento</a>
          <a href="#agendar" className="btn btn-primary" style={{ minHeight: 44, padding: '12px 22px' }}>Agendar</a>
        </nav>
      </div>
    </header>
  );
}
window.Header = Header;
