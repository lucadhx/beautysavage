import { z } from 'zod';

export const loginSchema = {
  body: z.object({
    email: z.string().email('Email invalide'),
    password: z.string().min(1, 'Mot de passe requis'),
  }),
};

export const devLoginSchema = {
  body: z.object({
    email: z.string().email('Email invalide'),
  }),
};

export const updateProfileSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'Le nom est requis').max(80, 'Nom trop long'),
  }),
};

export const forgotPasswordSchema = {
  body: z.object({
    email: z.string().trim().email('Email invalide'),
  }),
};

export const resetPasswordSchema = {
  body: z
    .object({
      token: z.string().min(20, 'Lien invalide').max(200),
      newPassword: z.string().min(6, 'Le nouveau mot de passe doit faire au moins 6 caractères'),
      confirmPassword: z.string().min(1, 'Confirmation requise'),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: 'Les mots de passe ne correspondent pas',
      path: ['confirmPassword'],
    }),
};

/**
 * ACTIVATION — MÊME POLITIQUE DE MOT DE PASSE QUE LA RÉINITIALISATION.
 *
 * Elle est reprise à l'identique, et volontairement : deux politiques
 * différentes pour poser le même secret finiraient par diverger, et c'est
 * toujours la plus permissive qui gagnerait — celle qu'on emprunte quand
 * l'autre refuse.
 */
export const activateAccountSchema = {
  body: z
    .object({
      token: z.string().min(20, 'Lien invalide').max(200),
      newPassword: z.string().min(6, 'Le mot de passe doit faire au moins 6 caractères'),
      confirmPassword: z.string().min(1, 'Confirmation requise'),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: 'Les mots de passe ne correspondent pas',
      path: ['confirmPassword'],
    }),
};

export const resendActivationSchema = {
  body: z.object({
    email: z.string().trim().email('Email invalide'),
  }),
};

export const changePasswordSchema = {
  body: z
    .object({
      currentPassword: z.string().min(1, 'Mot de passe actuel requis'),
      newPassword: z.string().min(6, 'Le nouveau mot de passe doit faire au moins 6 caractères'),
      confirmPassword: z.string().min(1, 'Confirmation requise'),
    })
    .refine((d) => d.newPassword === d.confirmPassword, {
      message: 'Les mots de passe ne correspondent pas',
      path: ['confirmPassword'],
    }),
};
