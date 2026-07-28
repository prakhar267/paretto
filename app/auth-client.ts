"use client";

import { createAuthClient } from "better-auth/react";
import {
  customSessionClient,
  usernameClient,
} from "better-auth/client/plugins";
import type { LearnerAuthInstance } from "@/app/learner-auth";

export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [
    usernameClient(),
    customSessionClient<LearnerAuthInstance>(),
  ],
});
