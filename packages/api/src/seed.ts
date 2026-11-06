import type { DatabaseSync } from 'node:sqlite';
import { demoPassword, hashPassword, newToken } from './security';

export const USERS = [
  { name: 'Alex' },
  { name: 'Sam' },
  { name: 'Priya' },
];

type SeedGroup = { name: string; readings: [string, number][] };
type SeedProject = { name: string; owner: number; members?: number[]; groups: SeedGroup[] };

const PROJECTS: SeedProject[] = [
  {
    name: 'Hendricks Kitchen Remodel',
    owner: 1,
    members: [3],
    groups: [
      {
        name: 'Base cabinets',
        readings: [
          ['Sink wall run', 3048],
          ['Range opening', 763],
          ['Fridge opening', 914],
          ['Counter depth', 637],
          ['Corner to window', 1217],
        ],
      },
      {
        name: 'Uppers',
        readings: [
          ['Counter to soffit', 1372],
          ['Hood width', 761],
          ['Left run', 1829],
          ['Right run', 1219],
        ],
      },
      {
        name: 'Window wall',
        readings: [
          ['Rough opening width', 924],
          ['Rough opening height', 1232],
          ['Sill height', 1067],
        ],
      },
    ],
  },
  {
    name: 'Unit 4B Flooring',
    owner: 1,
    groups: [
      {
        name: 'Living room',
        readings: [
          ['North wall', 4877],
          ['East wall', 3962],
          ['Closet depth', 610],
          ['Doorway', 813],
        ],
      },
      {
        name: 'Hallway',
        readings: [
          ['Length', 5486],
          ['Width', 1067],
          ['Threshold', 902],
        ],
      },
      {
        name: 'Bedroom 2',
        readings: [
          ['Long wall', 3658],
          ['Short wall', 3048],
          ['Closet width', 1524],
        ],
      },
    ],
  },
  {
    name: 'Garage Shelving',
    owner: 1,
    groups: [
      {
        name: 'North wall',
        readings: [
          ['Stud 1 to 2', 406],
          ['Stud 2 to 3', 405],
          ['Stud 3 to 4', 407],
          ['Wall length', 6096],
          ['Ceiling height', 2743],
        ],
      },
      {
        name: 'Shelf depths',
        readings: [
          ['Top shelf', 406],
          ['Middle shelf', 457],
          ['Bottom shelf', 610],
        ],
      },
    ],
  },
  {
    name: 'Maple St Deck',
    owner: 2,
    groups: [
      {
        name: 'Ledger',
        readings: [
          ['Ledger length', 4267],
          ['Height above grade', 838],
          ['Door offset', 1143],
        ],
      },
      {
        name: 'Joists',
        readings: [
          ['Joist span', 3658],
          ['Spacing 1', 406],
          ['Spacing 2', 407],
          ['Beam to rim', 610],
          ['Stair stringer', 1524],
        ],
      },
    ],
  },
];

const DEVICES = ['TP-3F2A', 'TP-91C4'];
const DAY = 24 * 60 * 60 * 1000;

export function seed(db: DatabaseSync) {
  const insertUser = db.prepare('INSERT INTO users (name, token, password_hash) VALUES (?, ?, ?)');
  const insertProject = db.prepare('INSERT INTO projects (name, owner_id) VALUES (?, ?)');
  const insertMember = db.prepare(
    'INSERT INTO project_members (project_id, user_id) VALUES (?, ?)',
  );
  const insertGroup = db.prepare('INSERT INTO measurement_groups (project_id, name) VALUES (?, ?)');
  const insertMeasurement = db.prepare(
    `INSERT INTO measurements (group_id, value, label, device_id, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const user of USERS) {
    insertUser.run(user.name, newToken(), hashPassword(demoPassword(user.name)));
  }

  let createdAt = Date.now() - 14 * DAY;
  for (const project of PROJECTS) {
    const projectId = Number(insertProject.run(project.name, project.owner).lastInsertRowid);
    insertMember.run(projectId, project.owner);
    for (const member of project.members ?? []) {
      insertMember.run(projectId, member);
    }
    for (const group of project.groups) {
      const groupId = Number(insertGroup.run(projectId, group.name).lastInsertRowid);
      for (const [label, value] of group.readings) {
        createdAt += 37 * 60 * 1000;
        const device = DEVICES[project.owner - 1];
        insertMeasurement.run(groupId, value, label, device, createdAt, project.owner);
      }
    }
    createdAt += 2 * DAY;
  }
}
