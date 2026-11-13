import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Utilise process.env.DATABASE_URL si elle existe (sur Render), sinon utilise les valeurs locales
const connectionString = process.env.DATABASE_URL;

export const pool = new Pool(
  connectionString
    ? {
        connectionString,
        ssl: {
          rejectUnauthorized: false, // Nécessaire pour Render
        },
      }
    : {
        user: 'postgres',
        host: 'localhost',
        database: 'docpulse_db',
        password: 'postgres123',
        port: 5432,
      }
);

pool.on('connect', () => {
  console.log('Connecté à la base de données PostgreSQL avec succès.');
});

pool.on('error', (err) => {
  console.error('Erreur inattendue sur le client PostgreSQL', err);
  process.exit(-1);
});
