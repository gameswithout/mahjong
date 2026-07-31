import type { AccelByteWebSdk } from "./iam";

export type FeedbackCategory = "gameplay" | "connection" | "ui" | "other";

export interface PlayerFeedback {
  category: FeedbackCategory;
  summary: string;
  details: string;
  sessionId?: string;
}

interface AxiosLike {
  put(url: string, body: unknown): Promise<{ data?: unknown }>;
}

export interface FeedbackClient {
  submit(feedback: PlayerFeedback): Promise<void>;
}

export function createFeedbackClient(
  sdk: AccelByteWebSdk,
  namespace: string,
  userId: string,
  now: () => number = Date.now,
): FeedbackClient {
  if (!namespace || !userId) {
    throw new Error("Feedback configuration is incomplete.");
  }
  const axios = sdk.assembly().axiosInstance as unknown as AxiosLike;

  return {
    async submit(feedback) {
      const recordKey = `mahjong-feedback-${now()}`;
      const endpoint =
        `/cloudsave/v1/namespaces/${encodeURIComponent(namespace)}` +
        `/users/${encodeURIComponent(userId)}/records/${recordKey}`;
      await axios.put(endpoint, {
        value: {
          category: feedback.category,
          summary: feedback.summary.trim(),
          details: feedback.details.trim(),
          sessionId: feedback.sessionId || undefined,
          submittedAt: new Date(now()).toISOString(),
          source: "web",
        },
        isPublic: false,
      });
    },
  };
}
