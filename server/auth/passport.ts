import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "../db.js";
import { users, type PublicUser } from "../../shared/schema.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Augment the user shape Passport stores in the session
    interface User extends PublicUser {}
  }
}

export function configurePassport(): void {
  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const [user] = await db
            .select()
            .from(users)
            .where(eq(users.email, email.toLowerCase()))
            .limit(1);

          if (!user) {
            return done(null, false, { message: "Invalid credentials" });
          }
          const ok = await bcrypt.compare(password, user.passwordHash);
          if (!ok) {
            return done(null, false, { message: "Invalid credentials" });
          }
          const { passwordHash: _ignored, ...publicUser } = user;
          void _ignored;
          return done(null, publicUser);
        } catch (err) {
          return done(err as Error);
        }
      },
    ),
  );

  passport.serializeUser<string>((user, done) => {
    done(null, (user as PublicUser).id);
  });

  passport.deserializeUser<string>(async (id, done) => {
    try {
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      if (!user) return done(null, false);
      const { passwordHash: _ignored, ...publicUser } = user;
      void _ignored;
      done(null, publicUser);
    } catch (err) {
      done(err as Error);
    }
  });
}
