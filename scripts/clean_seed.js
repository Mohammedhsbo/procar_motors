const fs = require('fs');

const data = fs.readFileSync('prisma/seed.ts', 'utf-8');
const lines = data.split('\n');

let out = [];
let inDemoUsers = false;
let inCustomers = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  if (line.includes('const DEMO_USERS:')) {
    inDemoUsers = true;
    out.push(`const DEMO_USERS: {
  email: string;
  nameEn: string;
  nameAr: string;
  roleKey: string;
  branchCode: string;
  phone: string;
}[] = [
  {
    email: 'superadmin@promotors.eg',
    nameEn: 'Super Admin',
    nameAr: 'مدير النظام الأعلى',
    roleKey: 'super_admin',
    branchCode: 'b1',
    phone: '+20 100 111 2233',
  },
  {
    email: 'admin@promotors.eg',
    nameEn: 'Branch Admin',
    nameAr: 'مدير الفرع',
    roleKey: 'branch_admin',
    branchCode: 'b1',
    phone: '+20 122 334 5566',
  },
  {
    email: 'reception@promotors.eg',
    nameEn: 'Reception',
    nameAr: 'الاستقبال',
    roleKey: 'reception',
    branchCode: 'b1',
    phone: '+20 111 220 8877',
  },
];`);
    continue;
  }
  
  if (inDemoUsers) {
    if (line.trim() === '];') {
      inDemoUsers = false;
    }
    continue;
  }
  
  if (line.includes('// Demo customers from mock-data')) {
    inCustomers = true;
    out.push(`  // Demo customers from mock-data
  const customers = [
    {
      nameEn: 'Ahmed Hassan',
      nameAr: 'أحمد حسن',
      phone: '+20 100 214 8890',
      status: 'active' as const,
    },
  ];

  for (const c of customers) {
    await prisma.customer.upsert({
      where: {
        organizationId_phone: { organizationId: org.id, phone: c.phone },
      },
      update: {},
      create: {
        organizationId: org.id,
        nameEn: c.nameEn,
        nameAr: c.nameAr,
        phone: c.phone,
        whatsapp: c.phone,
        status: c.status,
        preferredBranchId: branches.b1,
      },
    });
  }

  const ahmed = await prisma.customer.findFirstOrThrow({
    where: { phone: '+20 100 214 8890' },
  });

  const customerUser = await prisma.user.upsert({
    where: { customerId: ahmed.id },
    update: {
      passwordHash,
      status: 'active',
    },
    create: {
      organizationId: org.id,
      customerId: ahmed.id,
      email: 'customer@promotors.eg',
      username: ahmed.phone,
      passwordHash,
      userType: 'customer',
      status: 'active',
      locale: 'en',
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: customerUser.id, roleId: roleIds.customer! },
    },
    update: {},
    create: {
      userId: customerUser.id,
      roleId: roleIds.customer!,
    },
  });

  console.log('Seed complete.');
  console.log(\`Organization: \${org.nameEn}\`);
  console.log(\`Demo password for all users: Password123!\`);
}`);
    continue;
  }
  
  if (inCustomers) {
    if (line === '}') {
      inCustomers = false;
    }
    continue;
  }
  
  out.push(line);
}

fs.writeFileSync('prisma/seed.ts', out.join('\n'));
