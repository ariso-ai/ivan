import { Migration } from '../migration.js';
import { initialSchema } from './001_initial_schema.js';

export const migrations: Migration[] = [
  initialSchema
];