function Footer() {
  const Soc = ({ children, label }) => (
    <a href="#" aria-label={label} style={{
      width: 40, height: 40, borderRadius: '50%',
      border: '1px solid var(--line)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--fg)',
    }}>{children}</a>
  );
  const sv = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
  return (
    <footer style={{
      borderTop: '1px solid var(--line)',
      paddingBlock: 'clamp(48px, 6vw, 80px)',
    }}>
      <div className="container" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)',
        gap: 40, alignItems: 'start',
      }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 28, letterSpacing: '-0.01em', marginBottom: 6 }}>Marina Alves</div>
          <div className="eyebrow" style={{ marginBottom: 24 }}>PSICÓLOGA · CRP [CRP]</div>
          <p style={{ fontSize: 14, color: 'var(--fg-soft)', maxWidth: 460, lineHeight: 1.6 }}>
            Este site não substitui atendimento emergencial ou serviços de urgência. Em caso de crise, procure o CVV (188) ou um serviço de emergência local.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 24 }}>
          <div className="eyebrow">FALE COMIGO</div>
          <div style={{ display: 'flex', gap: 12 }}>
            <Soc label="WhatsApp"><svg {...sv}><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg></Soc>
            <Soc label="Instagram"><svg {...sv}><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg></Soc>
            <Soc label="E-mail"><svg {...sv}><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></Soc>
          </div>
          <div style={{ fontSize: 13, color: 'var(--fg-soft)' }}>
            © {new Date().getFullYear()} Marina Alves · Todos os direitos reservados
          </div>
        </div>
      </div>
    </footer>
  );
}
window.Footer = Footer;
