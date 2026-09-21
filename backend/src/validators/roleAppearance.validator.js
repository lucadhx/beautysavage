import { z } from 'zod';

const hex = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Couleur hexadécimale invalide');

const roleStyle = z.object({
  background: hex,
  foreground: hex,
});

export const roleAppearanceUpdateSchema = {
  body: z.object({
    roles: z.object({
      DEV: roleStyle,
      ADMIN: roleStyle,
    }),
  }),
};
