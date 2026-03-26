require("dotenv").config();
const pg = require("pg");
const { Pool } = pg;
const bcrypt = require("bcryptjs");

/** COUNT(*) وغيرها ترجع BIGINT كسلسلة؛ نحوّلها إلى رقم لتفادي أخطاء المقارنة في الواجهة */
pg.types.setTypeParser(pg.types.builtins.INT8, (val) => {
  if (val == null) return null;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? val : n;
});

/**
 * PostgreSQL عبر DATABASE_URL (مثل External Database URL من Render).
 * للاتصال المحلي بدون SSL: DATABASE_SSL=false أو استضافة localhost في الرابط.
 */
function poolSsl() {
  if (process.env.DATABASE_SSL === "0" || process.env.DATABASE_SSL === "false") {
    return false;
  }
  const u = String(process.env.DATABASE_URL || "");
  if (/localhost|127\.0\.0\.1/i.test(u)) {
    return false;
  }
  return { rejectUnauthorized: false };
}

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) {
    throw new Error(
      "DATABASE_URL is required. Set it to your PostgreSQL connection string (e.g. Render External Database URL)."
    );
  }
  return new Pool({
    connectionString: url.trim(),
    ssl: poolSsl(),
    max: 15,
  });
}

const pool = createPool();

/** تحويل معاملات SQLite (?) إلى صيغة pg ($1, $2, …) */
function toPgSql(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function shouldAppendReturningId(sql) {
  const s = sql.trim();
  if (!/^\s*INSERT\s/i.test(s)) return false;
  if (/RETURNING/i.test(s)) return false;
  if (/ON\s+CONFLICT/i.test(s)) return false;
  return true;
}

async function run(sql, params = []) {
  let text = toPgSql(sql);
  if (shouldAppendReturningId(sql)) {
    text = text.replace(/;?\s*$/u, "") + " RETURNING id";
  }
  const res = await pool.query(text, params);
  const id = res.rows[0]?.id;
  return {
    id: id != null ? Number(id) : 0,
    changes: res.rowCount ?? 0,
  };
}

async function get(sql, params = []) {
  const res = await pool.query(toPgSql(sql), params);
  return res.rows[0] ?? undefined;
}

async function all(sql, params = []) {
  const res = await pool.query(toPgSql(sql), params);
  return res.rows;
}

async function columnNames(table) {
  const rows = await all(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

/** أقسام السوق الشامل الافتراضية — تُزرع مرة عند قاعدة فارغة */
async function seedMarketplaceDefaults() {
  try {
    const c = await get(`SELECT COUNT(*)::int AS n FROM marketplace_sections`);
    if (c && Number(c.n) > 0) return;
    const rows = [
      ["malls", "مولات", "Malls", "تسوق من المولات", "Shop malls"],
      ["companies", "شركات", "Companies", "علامات وشركات", "Brands & companies"],
      ["appliances", "أدوات كهربائية", "Appliances", "أجهزة منزلية", "Home appliances"],
      ["electronics", "إلكترونيات", "Electronics", "تقنية وإلكترونيات", "Tech & electronics"],
      ["perfumes", "عطور", "Perfumes", "عطور ومستحضرات", "Fragrances"],
      ["accessories", "اكسسوارات", "Accessories", "إكسسوارات ومجوهرات", "Accessories"],
      ["shoes", "أحذية", "Shoes", "أحذية رجالية ونسائية", "Footwear"],
      ["offers", "عروض", "Offers", "عروض وتخفيضات", "Deals & offers"],
    ];
    let i = 0;
    for (const [slug, ar, en, sar, sen] of rows) {
      await run(
        `INSERT INTO marketplace_sections (slug, name_ar, name_en, subtitle_ar, subtitle_en, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`,
        [slug, ar, en, sar, sen, i++]
      );
    }
  } catch (_e) {
    /* ignore seed errors (e.g. concurrent deploy) */
  }
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS brands (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    logo TEXT,
    is_top_brand INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    subcategories_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description TEXT NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    discount DOUBLE PRECISION NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    subcategory TEXT,
    brand TEXT,
    sizes_json TEXT NOT NULL DEFAULT '[]',
    colors_json TEXT NOT NULL DEFAULT '[]',
    stock INTEGER NOT NULL DEFAULT 0,
    badge TEXT,
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_flash_sale INTEGER NOT NULL DEFAULT 0,
    flash_sale_end_time TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS product_images (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL
  )`);

  await run(`CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_no TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    total_price DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS order_status_history (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price DOUBLE PRECISION NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS contact_info (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    phones_json TEXT NOT NULL DEFAULT '[]',
    whatsapp_phone TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS product_offers (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    banner_image_url TEXT,
    discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
    offer_end_time TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS broadcast_messages (
    id SERIAL PRIMARY KEY,
    title_ar TEXT NOT NULL,
    title_en TEXT NOT NULL,
    body_ar TEXT,
    body_en TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS user_broadcast_reads (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    broadcast_id INTEGER NOT NULL REFERENCES broadcast_messages(id) ON DELETE CASCADE,
    read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, broadcast_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS in_app_notifications (
    id SERIAL PRIMARY KEY,
    message TEXT NOT NULL,
    target_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS in_app_notification_reads (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id INTEGER NOT NULL REFERENCES in_app_notifications(id) ON DELETE CASCADE,
    read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, notification_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`ALTER TABLE in_app_notifications ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await run(`ALTER TABLE in_app_notifications ADD COLUMN IF NOT EXISTS link_url TEXT`);
  await run(`ALTER TABLE in_app_notifications ADD COLUMN IF NOT EXISTS title TEXT`);

  await run(`CREATE TABLE IF NOT EXISTS marketplace_sections (
    id SERIAL PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    subtitle_ar TEXT NOT NULL DEFAULT '',
    subtitle_en TEXT NOT NULL DEFAULT '',
    card_image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS marketplace_vendors (
    id SERIAL PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES marketplace_sections(id) ON DELETE CASCADE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    vendor_type TEXT NOT NULL DEFAULT 'company',
    logo_url TEXT,
    cover_image_url TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS marketplace_products (
    id SERIAL PRIMARY KEY,
    section_id INTEGER NOT NULL REFERENCES marketplace_sections(id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL REFERENCES marketplace_vendors(id) ON DELETE CASCADE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    description_ar TEXT NOT NULL DEFAULT '',
    description_en TEXT NOT NULL DEFAULT '',
    price DOUBLE PRECISION NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    images_json TEXT NOT NULL DEFAULT '[]',
    is_offer INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    sales_count INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS marketplace_product_id INTEGER REFERENCES marketplace_products(id)`);

  await seedMarketplaceDefaults();

  await run(`CREATE TABLE IF NOT EXISTS site_ratings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS product_reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL,
    comment TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, product_id)
  )`);

  await migrateUsersColumns();
  await migrateUsersEmailAndPendingSignups();
  await migrateOrderItemsColumns();
  await migrateOrderItemsBrandColumn();
  await migrateProductsInventoryJson();
  await migrateBrandsShowcaseJson();
  await migrateAppBannersTable();
  await migrateOrderStatusesToV2();
  await migrateOrdersShippingAddressColumn();
  await migrateOrderNumbersSequential();
  await migrateContactHomeSectionImages();
  await migrateContactHomeSubcategorySlides();
  await migrateContactHomeSectionsVisibility();
  await migrateContactHomeSectionsOrder();
  await migrateProductsNewCollectionColumn();
  await migrateListPriceSemanticsOnce();
  await migrateVendorPlatformV1();
  await migrateVendorPlatformPartnerCtaPlacements();
  await migrateVendorSubscriptionUserLink();
  await migrateVendorJoinTermsAndDocImages();
  await migrateMarketplaceComprehensiveV2();
  await mergeCategorySubcategoriesWithDefaults();

  const admin = await get(`SELECT id FROM users WHERE role='admin' LIMIT 1`);
  if (!admin) {
    const hash = await bcrypt.hash("admin123", 10);
    await run(`INSERT INTO users (name, phone, password_hash, role) VALUES (?, ?, ?, 'admin')`, [
      "Admin",
      "0000000000",
      hash,
    ]);
  }

  const contact = await get(`SELECT id FROM contact_info LIMIT 1`);
  if (!contact) {
    await run(`INSERT INTO contact_info (address, phones_json, whatsapp_phone) VALUES (?, ?, ?)`, [
      "Riyadh, Saudi Arabia",
      JSON.stringify(["+966500000001", "+966500000002"]),
      "+966500000001",
    ]);
  }

  const categoryCount = await get(`SELECT COUNT(*)::int AS c FROM categories`);
  if (!categoryCount || Number(categoryCount.c) === 0) {
    await run(
      `INSERT INTO categories (name, subcategories_json) VALUES (?, ?), (?, ?), (?, ?)`,
      [
        "Men",
        JSON.stringify(["T-Shirts", "Pants", "Shoes", "Shirts", "Jackets", "Accessories", "Perfumes"]),
        "Women",
        JSON.stringify(["T-Shirts", "Dresses", "Tops", "Pants", "Jackets", "Accessories", "Bags", "Perfumes"]),
        "Kids",
        JSON.stringify(["T-Shirts", "Pants", "Boys", "Girls", "Baby", "Shoes", "Sets", "Perfumes"]),
      ]
    );
  }

  try {
    await run(
      `UPDATE contact_info SET whatsapp_phone=? WHERE id=(SELECT id FROM contact_info ORDER BY id LIMIT 1)`,
      ["971588978943"]
    );
  } catch (_e) {
    /* ignore */
  }
}

async function mergeCategorySubcategoriesWithDefaults() {
  const defaults = {
    Men: ["T-Shirts", "Pants", "Shoes", "Shirts", "Jackets", "Accessories", "Perfumes"],
    Women: ["T-Shirts", "Dresses", "Tops", "Pants", "Jackets", "Accessories", "Bags", "Perfumes"],
    Kids: ["T-Shirts", "Pants", "Boys", "Girls", "Baby", "Shoes", "Sets", "Perfumes"],
  };
  for (const [name, subs] of Object.entries(defaults)) {
    const row = await get(`SELECT id, subcategories_json FROM categories WHERE name=?`, [name]);
    if (!row) continue;
    let existing = [];
    try {
      existing = JSON.parse(row.subcategories_json || "[]");
    } catch (_e) {
      existing = [];
    }
    if (!Array.isArray(existing)) existing = [];
    const merged = [...new Set([...existing, ...subs])];
    await run(`UPDATE categories SET subcategories_json=? WHERE id=?`, [JSON.stringify(merged), row.id]);
  }
}

async function migrateContactHomeSectionImages() {
  await run(`ALTER TABLE contact_info ADD COLUMN IF NOT EXISTS home_main_section_images_json TEXT`);
}

async function migrateContactHomeSubcategorySlides() {
  await run(`ALTER TABLE contact_info ADD COLUMN IF NOT EXISTS home_subcategory_slides_json TEXT`);
}

async function migrateContactHomeSectionsVisibility() {
  await run(`ALTER TABLE contact_info ADD COLUMN IF NOT EXISTS home_sections_visibility_json TEXT`);
}

async function migrateContactHomeSectionsOrder() {
  await run(`ALTER TABLE contact_info ADD COLUMN IF NOT EXISTS home_sections_order_json TEXT`);
}

async function migrateProductsNewCollectionColumn() {
  await run(`ALTER TABLE products ADD COLUMN IF NOT EXISTS is_new_collection INTEGER NOT NULL DEFAULT 0`);
}

/** مرة واحدة: كان الحقل price يُفسَّر كسعر بعد الخصم؛ نحوّله إلى سعر قائمة (قبل الخصم) ليتوافق مع لوحة التحكم */
async function migrateListPriceSemanticsOnce() {
  await run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const ins = await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING id`,
    ["list_price_semantics_v1"]
  );
  if (!ins.rows || ins.rows.length === 0) return;
  await run(
    `UPDATE products SET price = price / (1.0 - discount / 100.0) WHERE discount > 0 AND discount < 100`
  );
}

async function migrateUsersColumns() {
  await run(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_enabled INTEGER NOT NULL DEFAULT 0`
  );
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notifications_snoozed_until TEXT`);
  await run(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS credentials_acknowledged INTEGER NOT NULL DEFAULT 0`
  );
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity_at TEXT`);
}

/** بريد للتحقق عند التسجيل + جدول انتظار OTP — الهاتف اختياري للمستخدمين الجدد */
async function migrateUsersEmailAndPendingSignups() {
  await run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  try {
    await run(`ALTER TABLE users ALTER COLUMN phone DROP NOT NULL`);
  } catch (_e) {
    /* قد يكون مُنفَّذاً أو غير مدعوم */
  }
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
    ON users (LOWER(TRIM(email)))
    WHERE email IS NOT NULL AND TRIM(email) <> ''
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS pending_email_signups (
      id SERIAL PRIMARY KEY,
      email_normalized TEXT NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      last_sent_at TIMESTAMPTZ NOT NULL,
      resend_count INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT pending_email_signups_email_unique UNIQUE (email_normalized)
    )
  `);
}

/** أرقام قديمة عشوائية أو غير ORD-##### → إعادة ترقيم متسلسل حسب تاريخ الإنشاء */
async function migrateOrderNumbersSequential() {
  try {
    const row = await get(
      `SELECT COUNT(*)::int AS c FROM orders WHERE order_no IS NULL OR TRIM(order_no) = '' OR order_no !~ '^ORD-[0-9]{5}$'`
    );
    if (!row || Number(row.c) === 0) return;
    const list = await all(
      `SELECT id FROM orders ORDER BY COALESCE(created_at, TIMESTAMP '1970-01-01') ASC, id ASC`
    );
    let seq = 0;
    for (const r of list) {
      seq += 1;
      const no = `ORD-${String(seq).padStart(5, "0")}`;
      await run(`UPDATE orders SET order_no=? WHERE id=?`, [no, r.id]);
    }
  } catch (e) {
    console.error("[db] migrateOrderNumbersSequential:", e.message || e);
  }
}

async function migrateOrderItemsColumns() {
  await run(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image_url TEXT`);
  await run(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS color TEXT`);
  await run(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS size TEXT`);
}

async function migrateOrderItemsBrandColumn() {
  await run(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS brand TEXT`);
}

async function migrateProductsInventoryJson() {
  await run(
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_json TEXT NOT NULL DEFAULT '[]'`
  );
}

async function migrateBrandsShowcaseJson() {
  await run(
    `ALTER TABLE brands ADD COLUMN IF NOT EXISTS showcase_categories_json TEXT NOT NULL DEFAULT '["Men","Women","Kids"]'`
  );
}

async function migrateAppBannersTable() {
  await run(`CREATE TABLE IF NOT EXISTS app_banners (
    id SERIAL PRIMARY KEY,
    title_ar TEXT NOT NULL DEFAULT '',
    title_en TEXT NOT NULL DEFAULT '',
    body_ar TEXT NOT NULL DEFAULT '',
    body_en TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL,
    link_url TEXT NOT NULL DEFAULT '',
    placement TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`ALTER TABLE app_banners ALTER COLUMN image_url DROP NOT NULL`);
}

async function migrateOrdersShippingAddressColumn() {
  await run(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address TEXT`);
}

/** إعدادات بائعي السوق الشامل، طلبات الانضمام، إعلانات المنتجات، الحصص والعمولة */
async function migrateVendorPlatformV1() {
  await run(`CREATE TABLE IF NOT EXISTS vendor_platform_settings (
    id INTEGER PRIMARY KEY,
    product_quota_enabled INTEGER NOT NULL DEFAULT 1,
    free_products_per_vendor INTEGER NOT NULL DEFAULT 20,
    extra_product_price_usd DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    commission_percent DOUBLE PRECISION NOT NULL DEFAULT 5,
    ads_module_enabled INTEGER NOT NULL DEFAULT 1,
    partner_banner_enabled INTEGER NOT NULL DEFAULT 1,
    partner_banner_text_ar TEXT NOT NULL DEFAULT 'انضم كشركة في Adora - اضغط هنا',
    partner_banner_text_en TEXT NOT NULL DEFAULT 'Join Adora as a company — click here',
    featured_products_mode TEXT NOT NULL DEFAULT 'manual',
    featured_vendor_ids_json TEXT NOT NULL DEFAULT '[]',
    bestsellers_boost_enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT vendor_platform_settings_single CHECK (id = 1)
  )`);
  await run(
    `INSERT INTO vendor_platform_settings (id, partner_banner_text_ar, partner_banner_text_en) VALUES (1, ?, ?) ON CONFLICT (id) DO NOTHING`,
    ["انضم كشركة في Adora - اضغط هنا", "Join Adora as a company — click here"]
  );

  await run(`CREATE TABLE IF NOT EXISTS vendor_subscription_requests (
    id SERIAL PRIMARY KEY,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    company_name TEXT NOT NULL,
    email TEXT NOT NULL,
    id_document TEXT NOT NULL,
    terms_accepted INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    admin_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS marketplace_product_promotions (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
    slot TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    price_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    max_impressions INTEGER,
    impressions_count INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_mp_promotions_slot_active ON marketplace_product_promotions (slot, is_active)`
  );
  await run(`CREATE INDEX IF NOT EXISTS idx_mp_promotions_product ON marketplace_product_promotions (product_id)`);

  await run(`ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS sku TEXT`);
  await run(`ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS barcode TEXT`);
  await run(`ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS is_mp_featured INTEGER NOT NULL DEFAULT 0`);

  await run(`ALTER TABLE marketplace_vendors ADD COLUMN IF NOT EXISTS paid_product_slots INTEGER NOT NULL DEFAULT 0`);
  await run(`ALTER TABLE marketplace_vendors ADD COLUMN IF NOT EXISTS is_premium INTEGER NOT NULL DEFAULT 0`);
  await run(`ALTER TABLE marketplace_vendors ADD COLUMN IF NOT EXISTS premium_until TIMESTAMPTZ`);
  await run(
    `ALTER TABLE marketplace_vendors ADD COLUMN IF NOT EXISTS premium_subscription_type TEXT NOT NULL DEFAULT 'none'`
  );

  await run(`ALTER TABLE order_items ADD COLUMN IF NOT EXISTS marketplace_commission_amount DOUBLE PRECISION`);
}

/** نصوص إضافية ومواضع ظهور دعوة «انضم كشركة» عبر التطبيق */
async function migrateVendorPlatformPartnerCtaPlacements() {
  await run(`ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS partner_cta_subtitle_ar TEXT NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS partner_cta_subtitle_en TEXT NOT NULL DEFAULT ''`);
  await run(
    `ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS partner_cta_placements_json TEXT NOT NULL DEFAULT '["home_under_search"]'`
  );
}

/** ربط طلب الانضمام كشركة بحساب المستخدم + مزامنة خلفية بالبريد */
async function migrateVendorSubscriptionUserLink() {
  await run(`ALTER TABLE vendor_subscription_requests ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
  await run(`CREATE INDEX IF NOT EXISTS idx_vendor_sub_req_user ON vendor_subscription_requests (user_id)`);
  try {
    await run(`
      UPDATE vendor_subscription_requests vsr
      SET user_id = u.id
      FROM users u
      WHERE vsr.user_id IS NULL
        AND LOWER(TRIM(vsr.email)) = LOWER(TRIM(COALESCE(u.email, '')))
        AND TRIM(COALESCE(u.email, '')) <> ''
        AND COALESCE(u.role, 'user') <> 'admin'
    `);
  } catch (_e) {
    /* ignore */
  }
}

/** شروط نموذج انضمام كشركة + حقول صور الهوية/السجل */
/** واجهة دخول السوق الشامل + أقسام داخل كل شركة + خصم المنتج + تقييمات */
async function migrateMarketplaceComprehensiveV2() {
  await run(`ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS marketplace_entrance_image_url TEXT`);
  await run(
    `ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS marketplace_entrance_title_ar TEXT NOT NULL DEFAULT ''`
  );
  await run(
    `ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS marketplace_entrance_title_en TEXT NOT NULL DEFAULT ''`
  );
  await run(
    `ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS marketplace_entrance_subtitle_ar TEXT NOT NULL DEFAULT ''`
  );
  await run(
    `ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS marketplace_entrance_subtitle_en TEXT NOT NULL DEFAULT ''`
  );

  await run(`CREATE TABLE IF NOT EXISTS marketplace_vendor_departments (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES marketplace_vendors(id) ON DELETE CASCADE,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_mvdept_vendor ON marketplace_vendor_departments (vendor_id)`);

  await run(
    `ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES marketplace_vendor_departments(id) ON DELETE SET NULL`
  );
  await run(
    `ALTER TABLE marketplace_products ADD COLUMN IF NOT EXISTS discount_percent DOUBLE PRECISION NOT NULL DEFAULT 0`
  );

  await run(`CREATE TABLE IF NOT EXISTS marketplace_product_reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marketplace_product_id INTEGER NOT NULL REFERENCES marketplace_products(id) ON DELETE CASCADE,
    stars INTEGER NOT NULL,
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT mp_reviews_user_product UNIQUE (user_id, marketplace_product_id)
  )`);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_mp_reviews_product ON marketplace_product_reviews (marketplace_product_id)`
  );

  const c = await get(`SELECT COUNT(*)::int AS n FROM marketplace_vendor_departments`);
  if (c && Number(c.n) === 0) {
    const vendors = await all(`SELECT id FROM marketplace_vendors`);
    for (const v of vendors) {
      const ins = await run(
        `INSERT INTO marketplace_vendor_departments (vendor_id, name_ar, name_en, sort_order, is_active) VALUES (?, ?, ?, ?, 1)`,
        [v.id, "رئيسي", "Main", 0]
      );
      const depId = ins.id;
      if (depId)
        await run(`UPDATE marketplace_products SET department_id=? WHERE vendor_id=? AND department_id IS NULL`, [
          depId,
          v.id,
        ]);
    }
  }
}

async function migrateVendorJoinTermsAndDocImages() {
  await run(`ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS vendor_join_terms_ar TEXT NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE vendor_platform_settings ADD COLUMN IF NOT EXISTS vendor_join_terms_en TEXT NOT NULL DEFAULT ''`);
  await run(`ALTER TABLE vendor_subscription_requests ADD COLUMN IF NOT EXISTS doc_type TEXT NOT NULL DEFAULT 'national_id'`);
  await run(`ALTER TABLE vendor_subscription_requests ADD COLUMN IF NOT EXISTS id_front_url TEXT`);
  await run(`ALTER TABLE vendor_subscription_requests ADD COLUMN IF NOT EXISTS id_back_url TEXT`);
  await run(`ALTER TABLE vendor_subscription_requests ADD COLUMN IF NOT EXISTS commercial_register_url TEXT`);
}

async function migrateOrderStatusesToV2() {
  const pairs = [
    ["pending", "pending_receipt"],
    ["processing", "in_progress"],
    ["shipped", "shipping"],
  ];
  for (const [from, to] of pairs) {
    try {
      await run(`UPDATE orders SET status=? WHERE status=?`, [to, from]);
    } catch (_e) {
      /* ignore */
    }
    try {
      await run(`UPDATE order_status_history SET status=? WHERE status=?`, [to, from]);
    } catch (_e) {
      /* ignore */
    }
  }
}

async function getDatabaseOverview() {
  const rows = await all(
    `SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const tables = [];
  let totalRows = 0;
  for (const row of rows) {
    const name = String(row.name || "");
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) continue;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const r = await get(`SELECT COUNT(*)::int AS c FROM ${quoted}`);
    const c = Number(r?.c ?? 0);
    totalRows += c;
    tables.push({ name, rowCount: c });
  }
  return { engine: "postgresql", internalOnly: false, tables, totalRows };
}

module.exports = { pool, run, get, all, initDb, getDatabaseOverview, columnNames };
