/**
 * Seed data for the three ecosystem applications: Tire Zone, UXB and Daily Cup.
 *
 * Everything sellable that holds stock is an `inventory.parts` row (decision
 * D5), so tires, film rolls and coffee beans all move through one engine.
 */
import type { PrismaClient } from '@prisma/client';

type Ctx = {
  prisma: PrismaClient;
  organizationId: string;
  branchIds: string[];
  primaryBranchId: string;
};

const TIRE_CATEGORY = 'TIRES';
const FILM_CATEGORY = 'FILM';
const INGREDIENT_CATEGORY = 'INGREDIENTS';

/** Creates (or reuses) an inventory part and returns its id. */
async function upsertPart(
  ctx: Ctx,
  categoryId: string,
  part: {
    sku: string;
    nameEn: string;
    nameAr: string;
    unit: string;
    costPrice: number;
    sellPrice: number;
    minStock?: number;
  },
) {
  const row = await ctx.prisma.part.upsert({
    where: {
      organizationId_sku: {
        organizationId: ctx.organizationId,
        sku: part.sku,
      },
    },
    update: {
      nameEn: part.nameEn,
      nameAr: part.nameAr,
      costPrice: part.costPrice,
      sellPrice: part.sellPrice,
    },
    create: {
      organizationId: ctx.organizationId,
      categoryId,
      sku: part.sku,
      nameEn: part.nameEn,
      nameAr: part.nameAr,
      unit: part.unit,
      costPrice: part.costPrice,
      sellPrice: part.sellPrice,
      minStock: part.minStock ?? 0,
      isActive: true,
    },
  });
  return row.id;
}

/** PartCategory has no code column, so it is matched by English name. */
async function upsertCategory(ctx: Ctx, _code: string, nameEn: string, nameAr: string) {
  const existing = await ctx.prisma.partCategory.findFirst({
    where: { organizationId: ctx.organizationId, nameEn },
  });
  if (existing) return existing.id;
  const created = await ctx.prisma.partCategory.create({
    data: { organizationId: ctx.organizationId, nameEn, nameAr },
  });
  return created.id;
}

/**
 * Puts opening stock into the primary branch's main warehouse only.
 *
 * Deliberately one warehouse, not all three: a part with balances in several
 * branches gives `findFirst({ where: { partId } })` more than one row to pick
 * from, which makes stock assertions ambiguous. Transfers between branches are
 * a real operation, not a seeding shortcut.
 */
async function stockUp(ctx: Ctx, partId: string, qty: number) {
  const warehouse = await ctx.prisma.warehouse.findFirst({
    where: { branchId: ctx.primaryBranchId },
    orderBy: [{ isDefault: 'desc' }, { code: 'asc' }],
  });
  if (!warehouse) return;
  await ctx.prisma.stockBalance.upsert({
    where: { warehouseId_partId: { warehouseId: warehouse.id, partId } },
    update: {},
    create: { warehouseId: warehouse.id, partId, onHand: qty, reserved: 0 },
  });
}

// ── Tire Zone ────────────────────────────────────────────────────────────

const TIRES = [
  { brand: 'Michelin', pattern: 'Primacy 4', w: 205, a: 55, r: 16, speed: 'V', load: '91', cost: 3100, price: 4250 },
  { brand: 'Michelin', pattern: 'Pilot Sport 4', w: 225, a: 45, r: 17, speed: 'Y', load: '94', cost: 4200, price: 5600 },
  { brand: 'Bridgestone', pattern: 'Turanza T005', w: 195, a: 65, r: 15, speed: 'H', load: '91', cost: 2350, price: 3200 },
  { brand: 'Bridgestone', pattern: 'Dueler H/T', w: 265, a: 65, r: 17, speed: 'T', load: '112', cost: 5100, price: 6800 },
  { brand: 'Pirelli', pattern: 'Cinturato P7', w: 205, a: 55, r: 16, speed: 'W', load: '91', cost: 3400, price: 4600 },
  { brand: 'Continental', pattern: 'EcoContact 6', w: 215, a: 60, r: 16, speed: 'H', load: '95', cost: 3000, price: 4100 },
  { brand: 'Goodyear', pattern: 'EfficientGrip', w: 195, a: 65, r: 15, speed: 'H', load: '91', cost: 2200, price: 3050 },
  { brand: 'Dunlop', pattern: 'SP Sport', w: 225, a: 45, r: 17, speed: 'W', load: '94', cost: 3600, price: 4900 },
];

const TIRE_SERVICES = [
  { code: 'MOUNT', nameEn: 'Mount & Fit', nameAr: 'تركيب إطار', price: 60, min: 15 },
  { code: 'BALANCE', nameEn: 'Wheel Balancing', nameAr: 'ترصيص عجل', price: 80, min: 20 },
  { code: 'ALIGN', nameEn: 'Wheel Alignment', nameAr: 'ضبط زوايا', price: 450, min: 45 },
  { code: 'PUNCTURE', nameEn: 'Puncture Repair', nameAr: 'إصلاح خرم', price: 120, min: 30 },
  { code: 'ROTATE', nameEn: 'Tire Rotation', nameAr: 'تدوير الإطارات', price: 150, min: 30 },
  { code: 'NITROGEN', nameEn: 'Nitrogen Fill', nameAr: 'تعبئة نيتروجين', price: 40, min: 10 },
];

/** Common sizes in the Egyptian market, keyed to popular models. */
const FITMENTS = [
  { make: 'Toyota', model: 'Corolla', from: 2014, to: 2019, w: 195, a: 65, r: 15 },
  { make: 'Toyota', model: 'Corolla', from: 2020, to: null, w: 205, a: 55, r: 16 },
  { make: 'Hyundai', model: 'Elantra', from: 2016, to: null, w: 205, a: 55, r: 16 },
  { make: 'Nissan', model: 'Sunny', from: 2015, to: null, w: 195, a: 65, r: 15 },
  { make: 'Chevrolet', model: 'Optra', from: 2014, to: null, w: 195, a: 65, r: 15 },
  { make: 'Kia', model: 'Cerato', from: 2018, to: null, w: 205, a: 55, r: 16 },
  { make: 'BMW', model: '320i', from: 2015, to: null, w: 225, a: 45, r: 17 },
  { make: 'Mercedes-Benz', model: 'C180', from: 2015, to: null, w: 225, a: 45, r: 17 },
  { make: 'Toyota', model: 'Fortuner', from: 2016, to: null, w: 265, a: 65, r: 17 },
  { make: 'Jeep', model: 'Grand Cherokee', from: 2014, to: null, w: 265, a: 65, r: 17 },
  { make: 'Volkswagen', model: 'Passat', from: 2016, to: null, w: 215, a: 60, r: 16 },
];

async function seedTireZone(ctx: Ctx) {
  const categoryId = await upsertCategory(ctx, TIRE_CATEGORY, 'Tires', 'إطارات');

  for (const t of TIRES) {
    const sku = `TZ-${t.brand.slice(0, 3).toUpperCase()}-${t.w}${t.a}${t.r}`;
    const nameEn = `${t.brand} ${t.pattern} ${t.w}/${t.a}R${t.r}`;
    const nameAr = `${t.brand} ${t.pattern} ${t.w}/${t.a}R${t.r}`;

    const partId = await upsertPart(ctx, categoryId, {
      sku,
      nameEn,
      nameAr,
      unit: 'pcs',
      costPrice: t.cost,
      sellPrice: t.price,
      minStock: 4,
    });
    await stockUp(ctx, partId, 16);

    const existing = await ctx.prisma.tireProduct.findUnique({
      where: { partId },
    });
    if (existing) continue;

    await ctx.prisma.tireProduct.create({
      data: {
        organizationId: ctx.organizationId,
        partId,
        sku,
        nameEn,
        nameAr,
        brand: t.brand,
        pattern: t.pattern,
        width: t.w,
        aspectRatio: t.a,
        rimDiameter: t.r,
        season: 'all_season',
        speedRating: t.speed,
        loadIndex: t.load,
        warrantyMonths: 24,
        warrantyKm: 40000,
      },
    });
  }

  for (const s of TIRE_SERVICES) {
    await ctx.prisma.tireService.upsert({
      where: {
        organizationId_code: {
          organizationId: ctx.organizationId,
          code: s.code,
        },
      },
      update: { price: s.price },
      create: {
        organizationId: ctx.organizationId,
        code: s.code,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        price: s.price,
        durationMin: s.min,
      },
    });
  }

  const fitmentCount = await ctx.prisma.tireFitment.count({
    where: { organizationId: ctx.organizationId },
  });
  if (fitmentCount === 0) {
    await ctx.prisma.tireFitment.createMany({
      data: FITMENTS.map((f) => ({
        organizationId: ctx.organizationId,
        make: f.make,
        model: f.model,
        yearFrom: f.from,
        yearTo: f.to,
        width: f.w,
        aspectRatio: f.a,
        rimDiameter: f.r,
      })),
    });
  }
}

// ── UXB ──────────────────────────────────────────────────────────────────

const UXB_CATEGORIES = [
  { code: 'window_film', nameEn: 'Window Film', nameAr: 'تظليل النوافذ', sort: 1 },
  { code: 'ppf', nameEn: 'Paint Protection Film', nameAr: 'حماية الطلاء PPF', sort: 2 },
  { code: 'car_care', nameEn: 'Car Care', nameAr: 'العناية بالسيارة', sort: 3 },
  { code: 'polishing', nameEn: 'Polishing & Coating', nameAr: 'التلميع والحماية', sort: 4 },
  { code: 'accessories', nameEn: 'Accessories', nameAr: 'إكسسوارات', sort: 5 },
];

const UXB_SIZE_CLASSES = [
  { code: 'small', nameEn: 'Small', nameAr: 'صغيرة', multiplier: 1.0, sort: 1 },
  { code: 'medium', nameEn: 'Medium', nameAr: 'متوسطة', multiplier: 1.25, sort: 2 },
  { code: 'large', nameEn: 'Large', nameAr: 'كبيرة', multiplier: 1.5, sort: 3 },
  { code: 'suv', nameEn: 'SUV / 4x4', nameAr: 'دفع رباعي', multiplier: 1.8, sort: 4 },
];

const UXB_SERVICES = [
  { code: 'WF-FULL', cat: 'window_film', nameEn: 'Full Window Film', nameAr: 'تظليل كامل', base: 3500, min: 120, warranty: 60 },
  { code: 'WF-FRONT', cat: 'window_film', nameEn: 'Windshield Film', nameAr: 'تظليل الزجاج الأمامي', base: 1800, min: 60, warranty: 60 },
  { code: 'PPF-FULL', cat: 'ppf', nameEn: 'Full Body PPF', nameAr: 'حماية كاملة للجسم', base: 42000, min: 960, warranty: 120 },
  { code: 'PPF-FRONT', cat: 'ppf', nameEn: 'Front End PPF', nameAr: 'حماية المقدمة', base: 14000, min: 300, warranty: 120 },
  { code: 'PPF-PANEL', cat: 'ppf', nameEn: 'Single Panel PPF', nameAr: 'حماية قطعة واحدة', base: 2800, min: 90, warranty: 120 },
  { code: 'CC-WASH', cat: 'car_care', nameEn: 'Premium Wash', nameAr: 'غسيل مميز', base: 350, min: 45, warranty: null },
  { code: 'CC-INTERIOR', cat: 'car_care', nameEn: 'Interior Detailing', nameAr: 'تنظيف داخلي شامل', base: 1200, min: 180, warranty: null },
  { code: 'PL-CORRECT', cat: 'polishing', nameEn: 'Paint Correction', nameAr: 'تصحيح الطلاء', base: 4500, min: 360, warranty: 6 },
  { code: 'PL-CERAMIC', cat: 'polishing', nameEn: 'Ceramic Coating', nameAr: 'طلاء سيراميك', base: 9500, min: 480, warranty: 36 },
];

const UXB_FILMS = [
  { sku: 'UXB-PPF-152', nameEn: 'PPF Roll 152cm', nameAr: 'لفة PPF 152سم', cost: 620, price: 980 },
  { sku: 'UXB-WF-100', nameEn: 'Window Film Roll 100cm', nameAr: 'لفة تظليل 100سم', cost: 180, price: 320 },
];

async function seedUxb(ctx: Ctx) {
  const categoryIds: Record<string, string> = {};
  for (const c of UXB_CATEGORIES) {
    const row = await ctx.prisma.uxbServiceCategory.upsert({
      where: {
        organizationId_code: {
          organizationId: ctx.organizationId,
          code: c.code,
        },
      },
      update: { nameEn: c.nameEn, nameAr: c.nameAr, sortOrder: c.sort },
      create: {
        organizationId: ctx.organizationId,
        code: c.code,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        sortOrder: c.sort,
      },
    });
    categoryIds[c.code] = row.id;
  }

  const sizeClassIds: Record<string, string> = {};
  for (const s of UXB_SIZE_CLASSES) {
    const row = await ctx.prisma.uxbSizeClass.upsert({
      where: {
        organizationId_code: {
          organizationId: ctx.organizationId,
          code: s.code,
        },
      },
      update: { multiplier: s.multiplier },
      create: {
        organizationId: ctx.organizationId,
        code: s.code,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        multiplier: s.multiplier,
        sortOrder: s.sort,
      },
    });
    sizeClassIds[s.code] = row.id;
  }

  for (const s of UXB_SERVICES) {
    const service = await ctx.prisma.uxbService.upsert({
      where: {
        organizationId_code: {
          organizationId: ctx.organizationId,
          code: s.code,
        },
      },
      update: { basePrice: s.base },
      create: {
        organizationId: ctx.organizationId,
        categoryId: categoryIds[s.cat]!,
        code: s.code,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        basePrice: s.base,
        durationMin: s.min,
        warrantyMonths: s.warranty,
      },
    });

    // Explicit price per size class, derived from the multiplier.
    for (const sc of UXB_SIZE_CLASSES) {
      await ctx.prisma.uxbServicePrice.upsert({
        where: {
          serviceId_sizeClassId: {
            serviceId: service.id,
            sizeClassId: sizeClassIds[sc.code]!,
          },
        },
        update: {},
        create: {
          serviceId: service.id,
          sizeClassId: sizeClassIds[sc.code]!,
          price: Math.round(s.base * sc.multiplier),
        },
      });
    }
  }

  // Film stock plus one open roll per branch to make consumption testable.
  const categoryId = await upsertCategory(ctx, FILM_CATEGORY, 'Films', 'أفلام');
  for (const f of UXB_FILMS) {
    const partId = await upsertPart(ctx, categoryId, {
      sku: f.sku,
      nameEn: f.nameEn,
      nameAr: f.nameAr,
      unit: 'm',
      costPrice: f.cost,
      sellPrice: f.price,
      minStock: 10,
    });
    await stockUp(ctx, partId, 150);

    const rollNo = `${f.sku}-R001`;
    await ctx.prisma.uxbMaterialRoll.upsert({
      where: {
        organizationId_rollNo: {
          organizationId: ctx.organizationId,
          rollNo,
        },
      },
      update: {},
      create: {
        organizationId: ctx.organizationId,
        branchId: ctx.primaryBranchId,
        partId,
        rollNo,
        widthCm: f.sku.includes('PPF') ? 152 : 100,
        initialM: 50,
        remainingM: 50,
        costPerM: f.cost,
      },
    });
  }
}

// ── Daily Cup ────────────────────────────────────────────────────────────

const INGREDIENTS = [
  { sku: 'DC-BEAN-ESP', nameEn: 'Espresso Beans', nameAr: 'بن إسبريسو', unit: 'g', cost: 0.55 },
  { sku: 'DC-MILK-FULL', nameEn: 'Full Cream Milk', nameAr: 'حليب كامل الدسم', unit: 'ml', cost: 0.035 },
  { sku: 'DC-MILK-OAT', nameEn: 'Oat Milk', nameAr: 'حليب الشوفان', unit: 'ml', cost: 0.09 },
  { sku: 'DC-SUGAR', nameEn: 'Sugar', nameAr: 'سكر', unit: 'g', cost: 0.03 },
  { sku: 'DC-CUP-M', nameEn: 'Medium Cup', nameAr: 'كوب وسط', unit: 'pcs', cost: 1.8 },
  { sku: 'DC-CUP-L', nameEn: 'Large Cup', nameAr: 'كوب كبير', unit: 'pcs', cost: 2.2 },
  { sku: 'DC-CHOC', nameEn: 'Chocolate Powder', nameAr: 'مسحوق شوكولاتة', unit: 'g', cost: 0.24 },
  { sku: 'DC-ICE', nameEn: 'Ice', nameAr: 'ثلج', unit: 'g', cost: 0.004 },
];

/** recipe code → ingredient SKU, quantity per serving, waste fraction */
const RECIPES: Record<
  string,
  { nameEn: string; nameAr: string; items: Array<[string, number, number]> }
> = {
  'ESPRESSO-M': {
    nameEn: 'Espresso (Medium)',
    nameAr: 'إسبريسو وسط',
    items: [['DC-BEAN-ESP', 18, 0.02], ['DC-CUP-M', 1, 0]],
  },
  'LATTE-M': {
    nameEn: 'Latte (Medium)',
    nameAr: 'لاتيه وسط',
    items: [['DC-BEAN-ESP', 18, 0.02], ['DC-MILK-FULL', 220, 0.03], ['DC-CUP-M', 1, 0]],
  },
  'LATTE-L': {
    nameEn: 'Latte (Large)',
    nameAr: 'لاتيه كبير',
    items: [['DC-BEAN-ESP', 27, 0.02], ['DC-MILK-FULL', 330, 0.03], ['DC-CUP-L', 1, 0]],
  },
  'MOCHA-M': {
    nameEn: 'Mocha (Medium)',
    nameAr: 'موكا وسط',
    items: [
      ['DC-BEAN-ESP', 18, 0.02],
      ['DC-MILK-FULL', 200, 0.03],
      ['DC-CHOC', 25, 0.01],
      ['DC-CUP-M', 1, 0],
    ],
  },
  'ICED-LATTE-L': {
    nameEn: 'Iced Latte (Large)',
    nameAr: 'آيس لاتيه كبير',
    items: [
      ['DC-BEAN-ESP', 27, 0.02],
      ['DC-MILK-FULL', 250, 0.03],
      ['DC-ICE', 150, 0],
      ['DC-CUP-L', 1, 0],
    ],
  },
};

const CAFE_MENU = [
  {
    category: { code: 'HOT', nameEn: 'Hot Drinks', nameAr: 'مشروبات ساخنة', sort: 1 },
    products: [
      {
        code: 'ESPRESSO',
        nameEn: 'Espresso',
        nameAr: 'إسبريسو',
        variants: [{ size: 'M', nameEn: 'Medium', nameAr: 'وسط', price: 35, recipe: 'ESPRESSO-M' }],
      },
      {
        code: 'LATTE',
        nameEn: 'Latte',
        nameAr: 'لاتيه',
        variants: [
          { size: 'M', nameEn: 'Medium', nameAr: 'وسط', price: 55, recipe: 'LATTE-M' },
          { size: 'L', nameEn: 'Large', nameAr: 'كبير', price: 70, recipe: 'LATTE-L' },
        ],
      },
      {
        code: 'MOCHA',
        nameEn: 'Mocha',
        nameAr: 'موكا',
        variants: [{ size: 'M', nameEn: 'Medium', nameAr: 'وسط', price: 65, recipe: 'MOCHA-M' }],
      },
    ],
  },
  {
    category: { code: 'COLD', nameEn: 'Cold Drinks', nameAr: 'مشروبات باردة', sort: 2 },
    products: [
      {
        code: 'ICED-LATTE',
        nameEn: 'Iced Latte',
        nameAr: 'آيس لاتيه',
        variants: [{ size: 'L', nameEn: 'Large', nameAr: 'كبير', price: 75, recipe: 'ICED-LATTE-L' }],
      },
    ],
  },
];

const MODIFIERS = [
  { code: 'EXTRA-SHOT', nameEn: 'Extra Shot', nameAr: 'شوت إضافي', delta: 15, sku: 'DC-BEAN-ESP', qty: 9 },
  { code: 'OAT-MILK', nameEn: 'Oat Milk', nameAr: 'حليب شوفان', delta: 20, sku: 'DC-MILK-OAT', qty: 220 },
  { code: 'NO-SUGAR', nameEn: 'No Sugar', nameAr: 'بدون سكر', delta: 0, sku: null, qty: null },
];

async function seedDailyCup(ctx: Ctx) {
  const categoryId = await upsertCategory(
    ctx,
    INGREDIENT_CATEGORY,
    'Ingredients',
    'مكوّنات',
  );

  const partIds: Record<string, string> = {};
  for (const i of INGREDIENTS) {
    partIds[i.sku] = await upsertPart(ctx, categoryId, {
      sku: i.sku,
      nameEn: i.nameEn,
      nameAr: i.nameAr,
      unit: i.unit,
      costPrice: i.cost,
      sellPrice: 0,
      minStock: 500,
    });
    await stockUp(ctx, partIds[i.sku]!, 20000);
  }

  const recipeIds: Record<string, string> = {};
  for (const [code, r] of Object.entries(RECIPES)) {
    const recipe = await ctx.prisma.cafeRecipe.upsert({
      where: {
        organizationId_code: { organizationId: ctx.organizationId, code },
      },
      update: { nameEn: r.nameEn, nameAr: r.nameAr },
      create: {
        organizationId: ctx.organizationId,
        code,
        nameEn: r.nameEn,
        nameAr: r.nameAr,
        yieldQty: 1,
        yieldUnit: 'cup',
      },
    });
    recipeIds[code] = recipe.id;

    for (const [index, [sku, qty, waste]] of r.items.entries()) {
      const partId = partIds[sku];
      if (!partId) continue;
      const unit = INGREDIENTS.find((i) => i.sku === sku)?.unit ?? 'unit';
      await ctx.prisma.cafeRecipeItem.upsert({
        where: { recipeId_partId: { recipeId: recipe.id, partId } },
        update: { qty, wastePct: waste },
        create: {
          recipeId: recipe.id,
          partId,
          qty,
          unit,
          wastePct: waste,
          sortOrder: index,
        },
      });
    }
  }

  for (const group of CAFE_MENU) {
    const category = await ctx.prisma.cafeCategory.upsert({
      where: {
        organizationId_code: {
          organizationId: ctx.organizationId,
          code: group.category.code,
        },
      },
      update: {},
      create: {
        organizationId: ctx.organizationId,
        code: group.category.code,
        nameEn: group.category.nameEn,
        nameAr: group.category.nameAr,
        sortOrder: group.category.sort,
      },
    });

    for (const [pIndex, p] of group.products.entries()) {
      const product = await ctx.prisma.cafeProduct.upsert({
        where: {
          organizationId_code: {
            organizationId: ctx.organizationId,
            code: p.code,
          },
        },
        update: { nameEn: p.nameEn, nameAr: p.nameAr },
        create: {
          organizationId: ctx.organizationId,
          categoryId: category.id,
          code: p.code,
          nameEn: p.nameEn,
          nameAr: p.nameAr,
          sortOrder: pIndex,
        },
      });

      for (const [vIndex, v] of p.variants.entries()) {
        await ctx.prisma.cafeProductVariant.upsert({
          where: {
            productId_size: { productId: product.id, size: v.size },
          },
          update: { price: v.price, recipeId: recipeIds[v.recipe] ?? null },
          create: {
            productId: product.id,
            size: v.size,
            nameEn: v.nameEn,
            nameAr: v.nameAr,
            price: v.price,
            recipeId: recipeIds[v.recipe] ?? null,
            sortOrder: vIndex,
          },
        });
      }
    }
  }

  for (const m of MODIFIERS) {
    await ctx.prisma.cafeModifier.upsert({
      where: {
        organizationId_code: {
          organizationId: ctx.organizationId,
          code: m.code,
        },
      },
      update: { priceDelta: m.delta },
      create: {
        organizationId: ctx.organizationId,
        code: m.code,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        priceDelta: m.delta,
        ingredientPartId: m.sku ? (partIds[m.sku] ?? null) : null,
        qty: m.qty,
      },
    });
  }
}

// ── Workshop fixtures ────────────────────────────────────────────────────
// Spare parts and suppliers the Pro Motors workshop works with. These were
// lost when the project moved, which left the inventory, purchasing and
// finance e2e suites unable to find the records they assert against.

const WORKSHOP_PARTS = [
  { sku: 'BRK-1042', nameEn: 'Front Brake Pads', nameAr: 'تيل فرامل أمامي', unit: 'set', cost: 620, price: 950, min: 4 },
  { sku: 'OIL-5W30', nameEn: 'Engine Oil 5W-30 (1L)', nameAr: 'زيت محرك 5W-30 لتر', unit: 'L', cost: 145, price: 220, min: 20 },
  { sku: 'FLT-0921', nameEn: 'Oil Filter', nameAr: 'فلتر زيت', unit: 'pcs', cost: 85, price: 140, min: 10 },
  { sku: 'BAT-70A', nameEn: 'Battery 70Ah', nameAr: 'بطارية 70 أمبير', unit: 'pcs', cost: 2400, price: 3300, min: 3 },
];

const SUPPLIERS = [
  { nameEn: 'AutoParts Egypt', nameAr: 'أوتو بارتس مصر', phone: '+20 2 2555 1010', email: 'sales@autoparts.eg', taxId: '331-556-889' },
  { nameEn: 'Delta Lubricants', nameAr: 'دلتا للزيوت', phone: '+20 2 2555 2020', email: 'orders@deltalub.eg', taxId: '447-112-903' },
];

async function seedWorkshopFixtures(ctx: Ctx) {
  const categoryId = await upsertCategory(ctx, 'SPARES', 'Spare Parts', 'قطع غيار');

  for (const p of WORKSHOP_PARTS) {
    const partId = await upsertPart(ctx, categoryId, {
      sku: p.sku,
      nameEn: p.nameEn,
      nameAr: p.nameAr,
      unit: p.unit,
      costPrice: p.cost,
      sellPrice: p.price,
      minStock: p.min,
    });
    await stockUp(ctx, partId, 100);
  }

  for (const s of SUPPLIERS) {
    const existing = await ctx.prisma.supplier.findFirst({
      where: { organizationId: ctx.organizationId, nameEn: s.nameEn },
    });
    if (existing) continue;
    await ctx.prisma.supplier.create({
      data: {
        organizationId: ctx.organizationId,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        phone: s.phone,
        email: s.email,
        taxId: s.taxId,
      },
    });
  }
}

/** Gives the first customer a UXB loyalty profile so the app has an anchor. */
async function seedUxbProfile(ctx: Ctx) {
  const customer = await ctx.prisma.customer.findFirst({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'asc' },
  });
  if (!customer) return;
  await ctx.prisma.uxpProfile.upsert({
    where: { customerId: customer.id },
    update: {},
    create: { customerId: customer.id, loyaltyPts: 0 },
  });
}

export async function seedEcosystem(ctx: Ctx) {
  await seedWorkshopFixtures(ctx);
  await seedTireZone(ctx);
  await seedUxb(ctx);
  await seedUxbProfile(ctx);
  await seedDailyCup(ctx);
  console.log(
    'Ecosystem seed complete: workshop fixtures, Tire Zone, UXB, Daily Cup.',
  );
}
