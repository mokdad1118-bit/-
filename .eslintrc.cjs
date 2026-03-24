/* فحص جودة JS — تشغيل: npm run lint */
/* ملفات الواجهة تستدعي دوالاً من HTML (onclick) فيظهر وهم «غير مستخدم» لـ ESLint */
module.exports = {
  root: true,
  ignorePatterns: ["node_modules/**", "uploads/**", ".eslintrc.cjs"],
  parserOptions: { ecmaVersion: 2022, sourceType: "script" },
  extends: ["eslint:recommended"],
  overrides: [
    {
      files: ["server.js", "db.js", "auth.js", "ecosystem.config.cjs", "scripts/**/*.cjs", "scripts/**/*.js"],
      env: { node: true, es2022: true },
    },
    {
      files: ["adora-config.js"],
      env: { browser: true, es2022: true },
      globals: { window: "readonly" },
    },
    {
      files: ["index-page.js", "public/admin.js"],
      env: { browser: true, es2022: true },
      rules: {
        "no-unused-vars": "off",
        "no-empty": ["error", { allowEmptyCatch: true }],
      },
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        fetch: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        URLSearchParams: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        IntersectionObserver: "readonly",
        MutationObserver: "readonly",
        getComputedStyle: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        alert: "readonly",
        console: "readonly",
        io: "readonly",
        SpeechRecognition: "readonly",
        webkitSpeechRecognition: "readonly",
      },
    },
    {
      files: ["sw.js"],
      env: { serviceworker: true, es2022: true },
    },
  ],
  rules: {
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "no-redeclare": "warn",
  },
};
