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
        <aside style={{
          background: 'var(--bg-soft)',
          borderRadius: 'var(--radius-lg)',
          padding: 'clamp(32px, 4vw, 56px)',
          position: 'sticky',
          top: 120,
          border: '1px solid var(--line)',
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: 'clamp(28px, 2.6vw, 36px)',
            lineHeight: 1.25,
            color: 'var(--accent)',
            marginBottom: 32,
            letterSpacing: '-0.005em',
          }}>
            “Cuidar da saúde emocional é também construir uma relação mais inteira consigo.”
          </div>
          <div style={{
            width: 48, height: 1, background: 'var(--accent-soft)', marginBottom: 28,
          }}></div>
          <dl style={{
            display: 'grid', gridTemplateColumns: '1fr',
            rowGap: 20, margin: 0,
          }}>
            {meta.map((m, i) => (
              <div key={i}>
                <dt className="eyebrow" style={{ fontSize: 11, marginBottom: 4 }}>{m.k.toUpperCase()}</dt>
                <dd style={{ margin: 0, fontSize: 15, color: 'var(--fg)', lineHeight: 1.45 }}>{m.v}</dd>
              </div>
            ))}
          </dl>
        </aside>
        <div>
          <div className="eyebrow" style={{ marginBottom: 18 }}>SOBRE MIM</div>
          <h2 style={{ marginBottom: 28 }}>
            Oi, eu sou a Marina.
          </h2>
          <p style={{ marginBottom: 20, fontSize: 18, lineHeight: 1.7, color: 'var(--fg)' }}>
            Sou psicóloga e atuo a partir da abordagem sistêmica, olhando para a pessoa em relação com sua história, seus vínculos, seus contextos e os padrões que atravessam sua forma de sentir, escolher e se relacionar.
          </p>
          <p style={{ marginBottom: 20, fontSize: 18, lineHeight: 1.7, color: 'var(--fg-muted)' }}>
            Meu trabalho é construir um espaço seguro de escuta, reflexão e elaboração, para que você possa compreender melhor o que vive e encontrar formas mais leves e possíveis de lidar com suas dificuldades.
          </p>
          <p style={{ fontSize: 18, lineHeight: 1.7, color: 'var(--fg-muted)' }}>
            Atendo pessoas que chegam com ansiedade, sobrecarga emocional, questões de relacionamento, autoestima, sexualidade e momentos de transição. Cada processo é único — e construído no seu tempo.
          </p>
        </div>
      </div>
    </section>
  );
}
window.Sobre = Sobre;
