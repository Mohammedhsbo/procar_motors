const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    include: {
      roles: {
        include: {
          role: true
        }
      }
    }
  });

  console.log(`Total users: ${users.length}`);
  for (const u of users) {
    const roles = u.roles.map(r => r.role.key).join(', ');
    console.log(`- Email: ${u.email} | Type: ${u.userType} | Username: ${u.username} | Roles: ${roles}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
