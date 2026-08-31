import { definePlugin } from "nitro";

interface ResponseHookRegistrar {
  hook(name: "response", callback: (response: Response, event: { req: Request }) => void): void;
}

interface WebMcpOriginTrialEnvironment {
  WEBMCP_ORIGIN_TRIAL_TOKEN?: string | undefined;
}

function validToken(environment: WebMcpOriginTrialEnvironment): string | null {
  const token = environment.WEBMCP_ORIGIN_TRIAL_TOKEN?.trim();
  if (!token || /[\r\n]/.test(token)) return null;
  return token;
}

/**
 * Emit the native WebMCP Origin-Trial token as a response header only.
 * The response body and client runtime configuration remain untouched.
 */
export function registerWebMcpOriginTrial(
  registrar: ResponseHookRegistrar,
  environment: WebMcpOriginTrialEnvironment = process.env,
): void {
  const token = validToken(environment);
  if (!token) return;

  registrar.hook("response", (response) => {
    response.headers.set("Origin-Trial", token);
  });
}

export default definePlugin((nitro) => {
  registerWebMcpOriginTrial(nitro.hooks);
});
