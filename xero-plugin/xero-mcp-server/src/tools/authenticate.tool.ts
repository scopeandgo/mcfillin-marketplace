import { z } from "zod";
import { xeroClient, AuthRequiredError } from "../clients/xero-client.js";
import { CreateXeroTool } from "../helpers/create-xero-tool.js";

const AuthenticateTool = CreateXeroTool(
  "authenticate",
  "Initiate or verify the OAuth connection to Xero. \
Call this tool when the user wants to connect to Xero or when a Xero tool \
reports an authentication error. If a valid session exists it confirms the \
connection; otherwise it returns an authorisation URL that the user must \
open in their browser to complete the OAuth flow.",
  {},
  async () => {
    try {
      await xeroClient.authenticate();
      return {
        content: [
          { type: "text" as const, text: "Xero connection is active." },
        ],
      };
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        return {
          content: [{ type: "text" as const, text: err.message }],
        };
      }
      throw err;
    }
  },
);

export default AuthenticateTool;