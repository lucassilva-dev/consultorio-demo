function Sobre() {
  const meta = [
    { k: 'Formação', v: 'Psicologia · Abordagem sistêmica' },
    { k: 'Registro', v: 'CRP [CRP]' },
    { k: 'Atuação', v: 'Clínica · adolescentes, jovens adultos e adultos' },
    { k: 'Modalidade', v: 'Atendimento online · sessões agendadas' },
  ];
  return (
    <section id="sobre" className="section">
      <div className="container" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
        gap: 'clamp(40px, 8vw, 120px)',
        alignItems: 'start',
      }}>
        <div style={{
          aspectRatio: '4 / 5',
          background: 'var(--bg-soft)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-1)',
          position: 'sticky',
          top: 120,
        }}>
          <img src="../../assets/portrait-placeholder.svg" alt="Marina Alves"
               style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 18 }}>SOBRE MIM</div>
          <h2 style={{ marginBottom: 28 }}>
            Oi, eu sou a<br/>
            <span style={{ fontStyle: 'italic', color: 'var(--accent)' }}>Marina</span>.
          </h2>
          <p style={{ marginBottom: 20, fontSize: 18, lineHeight: 1.7, color: 'var(--fg)' }}>
            Sou psicóloga e atuo a partir da abordagem sistêmica, olhando para a pessoa em relação com sua história, seus vínculos, seus contextos e os padrões que atravessam sua forma de sentir, escolher e se relacionar.
          </p>
          <p style={{ marginBottom: 36, fontSize: 18, lineHeight: 1.7, color: 'var(--fg-muted)' }}>
            Meu trabalho é construir um espaço seguro de escuta, reflexão e elaboração, para que você possa compreender melhor o que vive e encontrar formas mais leves e possíveis de lidar com suas dificuldades.
          </p>
          <dl style={{
            display: 'grid', gridTemplateColumns: '160px 1fr',
            rowGap: 14, columnGap: 24, margin: 0,
            borderTop: '1px solid var(--line)', paddingTop: 24,
          }}>
            {meta.map((m, i) => (
              <React.Fragment key={i}>
                <dt className="eyebrow" style={{ fontSize: 12 }}>{m.k.toUpperCase()}</dt>
                <dd style={{ margin: 0, fontSize: 16, color: 'var(--fg)' }}>{m.v}</dd>
              </React.Fragment>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
window.Sobre = Sobre;
