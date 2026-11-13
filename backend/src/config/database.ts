import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'docpulse_db',
    password: 'postgres123', // Le mot de passe configuré
    port: 5432,
});

pool.on('connect', () => {
    console.log('Connecté à la base de données PostgreSQL avec succès.');
});

pool.on('error', (err) => {
    console.error('Erreur inattendue sur le client PostgreSQL', err);
    process.exit(-1);
});
