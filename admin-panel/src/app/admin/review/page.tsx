import { redirect } from "next/navigation";

type ReviewRedirectPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ReviewRedirectPage({ searchParams }: ReviewRedirectPageProps) {
  const sp = (await searchParams) ?? {};
  const statusRaw = sp.status;
  const reviewIdRaw = sp.review_id;
  const status = Array.isArray(statusRaw) ? statusRaw[0] : statusRaw;
  const reviewId = Array.isArray(reviewIdRaw) ? reviewIdRaw[0] : reviewIdRaw;
  const normalizedStatus =
    status === "approved" || status === "rejected" || status === "edited" ? status : "pending";
  const next = `/admin?workspace=conversations&review_status=${encodeURIComponent(normalizedStatus)}${
    reviewId ? `&review_id=${encodeURIComponent(reviewId)}` : ""
  }`;
  redirect(next);
}
