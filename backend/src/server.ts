import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { pool } from './config/database';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// --- CONFIGURATION MULTER (Stockage dynamique par nom d'entreprise) ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const { token } = req.params;
            // Récupérer le nom de l'entreprise associé au token dans la BDD
            const query = 'SELECT company_id FROM collection_requests WHERE secure_token = $1;';
            const result = await pool.query(query, [token]);
            
            let companyName = "generique";
            if (result.rows.length > 0 && result.rows[0].company_id) {
                // Nettoyer le nom de l'entreprise pour éviter les caractères spéciaux dans les dossiers
                companyName = result.rows[0].company_id.replace(/[^a-zA-Z0-9_-]/g, '_');
            }

            // Dossier physique : uploads/[Nom_De_L_Entreprise]/
            const uploadDir = path.join(__dirname, '../uploads', companyName);
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        } catch (error) {
            console.error("Erreur lors de la création du dossier d'entreprise :", error);
            const fallbackDir = path.join(__dirname, '../uploads/generique');
            if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
            cb(null, fallbackDir);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Limite à 10 Mo par fichier
});

// --- CONFIGURATION EMAIL (Nodemailer) ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER || 'ton_email@gmail.com',
        pass: process.env.EMAIL_PASS || 'ton_mot_de_passe_app_google'
    }
});

// ==========================================
// ROUTES API
// ==========================================

// 1. Route Admin : Création de la demande avec les documents personnalisés
app.post('/api/requests', async (req: Request, res: Response) => {
    try {
        const { companyId, recipientName, recipientEmail, requestedDocs } = req.body;

        if (!companyId || !recipientName || !recipientEmail || !requestedDocs) {
            return res.status(400).json({ success: false, error: 'Tous les champs sont obligatoires.' });
        }

        const secureToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Valide 7 jours

        const query = `
            INSERT INTO collection_requests (company_id, recipient_name, recipient_email, template_id, secure_token, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, secure_token;
        `;
        // On stocke la liste des documents demandés dans template_id ou un champ dédié
        const values = [companyId, recipientName, recipientEmail, requestedDocs, secureToken, expiresAt];
        const result = await pool.query(query, values);

        const newRequest = result.rows[0];
        const baseUrl = process.env.FRONTEND_URL || 'https://docpulse-bckend.onrender.com';
        const magicLink = `${baseUrl}/admin.html?token=${newRequest.secure_token}`;

        res.status(201).json({
            success: true,
            message: 'Demande créée avec succès',
            data: {
                requestId: newRequest.id,
                secure_token: newRequest.secure_token,
                magicLink
            }
        });
    } catch (error) {
        console.error('Erreur lors de la création de la demande :', error);
        res.status(500).json({ success: false, error: 'Erreur interne du serveur' });
    }
});

// Route pour que la page client récupère les documents exigés par l'entreprise
app.get('/api/request/:token', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const query = 'SELECT * FROM collection_requests WHERE secure_token = $1 AND expires_at > NOW();';
        const result = await pool.query(query, [token]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Lien invalide ou expiré.' });
        }

        res.status(200).json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Erreur récupération requête :', error);
        res.status(500).json({ success: false, error: 'Erreur serveur' });
    }
});

// 2. Route Client : Upload des fichiers, stockage dans le dossier entreprise et envoi par e-mail
app.post('/api/upload/:token', upload.any(), async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            return res.status(400).json({ success: false, error: 'Aucun fichier fourni.' });
        }

        // Vérifier si le token est valide
        const tokenQuery = `
            SELECT * FROM collection_requests 
            WHERE secure_token = $1 AND expires_at > NOW();
        `;
        const tokenResult = await pool.query(tokenQuery, [token]);

        if (tokenResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Lien invalide ou expiré.' });
        }

        const requestData = tokenResult.rows[0];

        // Préparer les pièces jointes pour l'e-mail à partir des fichiers uploadés
        const attachments = files.map(file => ({
            filename: file.originalname,
            path: file.path
        }));

        // Envoi direct par e-mail à l'entreprise
        const mailOptions = {
            from: 'DocPulse <noreply@docpulse.com>',
            to: requestData.recipient_email, // E-mail de l'entreprise saisi dans le formulaire admin
            subject: `[DocPulse] Nouveaux documents reçus de la part de ${requestData.recipient_name}`,
            text: `Bonjour,\n\nVous venez de recevoir l'ensemble des documents requis de la part de ${requestData.recipient_name}.\n\nLes fichiers sont joints à cet e-mail et ont également été classés dans votre dossier d'entreprise.\n\nCordialement,\nL'équipe DocPulse`,
            attachments: attachments
        };

        await transporter.sendMail(mailOptions);
        console.log(`[EMAIL & STOCKAGE] Documents transmis avec succès à l'entreprise : ${requestData.recipient_email}`);

        res.status(200).json({
            success: true,
            message: 'Documents téléchargés, enregistrés dans le dossier et envoyés par e-mail à l\'entreprise avec succès !'
        });
    } catch (error: any) {
        console.error('Erreur lors de l\'upload ou de l\'envoi de l\'e-mail :', error);
        res.status(500).json({ success: false, error: error.message || 'Erreur lors du traitement des fichiers.' });
    }
});

app.listen(Number(PORT), () => {
    console.log(`Serveur backend démarré sur le port ${PORT}`);
});
