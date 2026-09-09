/* Configuration Tailwind — sert à générer assets/tailwind.css.
   Les couleurs pointent vers les variables CSS définies dans index.html,
   ce qui permet aux thèmes clair et sombre de partager les mêmes classes. */
module.exports = {
  content: ['./index.html', './moderation.html', './js/**/*.js'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        soft: 'rgb(var(--soft) / <alpha-value>)',
        iris: 'rgb(var(--iris) / <alpha-value>)',
        iris2: 'rgb(var(--iris2) / <alpha-value>)',
        mint: 'rgb(var(--mint) / <alpha-value>)',
        amber: 'rgb(var(--amber) / <alpha-value>)',
        coral: 'rgb(var(--coral) / <alpha-value>)',
        inverse: 'rgb(var(--inverse) / <alpha-value>)',
        'sur-inverse': 'rgb(var(--sur-inverse) / <alpha-value>)'
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        lift: '0 24px 60px -28px var(--ombre)',
        glow: '0 18px 44px -18px rgba(124,92,255,.55)',
        carte: '0 2px 10px -4px var(--ombre), 0 12px 40px -24px var(--ombre)'
      },
      maxWidth: { contenu: '1120px' }
    }
  },
  plugins: []
};
