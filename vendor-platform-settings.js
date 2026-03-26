const { get } = require("./db");

async function getVendorPlatformSettings() {
  return await get(`SELECT * FROM vendor_platform_settings WHERE id = 1`);
}

module.exports = { getVendorPlatformSettings };
