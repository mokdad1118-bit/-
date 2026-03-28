/** @type {import('tailwindcss').Config} */
/** تطبيق المتجر فقط — لا تضمّن admin هنا (له tailwind.admin.config.js) */
module.exports = {
  content: ["./index.html", "./index-page.js"],
  theme: {
    /* هاتف فقط: استعلامات min-width للشاشات لا تُفعّل على سطح المكتب */
    screens: {
      sm: "99999px",
      md: "99999px",
      lg: "99999px",
      xl: "99999px",
      "2xl": "99999px",
    },
    extend: {},
  },
  plugins: [],
};
