import { mapPrsToFeed, type GhPr } from "./map";

type GraphQlPullRequest = {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
  isDraft: boolean;
  repository: { nameWithOwner: string };
  author: { login: string } | null;
  statusCheckRollup: { state: string } | null;
  reviewDecision: string | null;
};

type GraphQlResponse = {
  data?: { search?: { nodes?: GraphQlPullRequest[] } };
  errors?: Array<{ message?: string }>;
};

const graphqlQuery = `query SearchPullRequests($search: String!) {
  search(query: $search, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        updatedAt
        isDraft
        repository { nameWithOwner }
        author { login }
        statusCheckRollup { state }
        reviewDecision
      }
    }
  }
}`;

const searches = {
  review: "is:open is:pr review-requested:@me",
  mine: "is:open is:pr author:@me",
  assigned: "is:open is:pr assignee:@me",
};

function decode(output: Uint8Array): string {
  return new TextDecoder().decode(output);
}

function ciState(state: string | null | undefined): GhPr["ci"] {
  if (state === "SUCCESS") {
    return "pass";
  }

  if (state === "FAILURE" || state === "ERROR") {
    return "fail";
  }

  if (state === "PENDING" || state === "EXPECTED" || state === "QUEUED" || state === "IN_PROGRESS") {
    return "pending";
  }

  return null;
}

function reviewState(state: string | null): GhPr["review"] {
  if (state === "APPROVED") {
    return "approved";
  }

  if (state === "CHANGES_REQUESTED") {
    return "changes_requested";
  }

  if (state === "REVIEW_REQUIRED") {
    return "review_required";
  }

  return null;
}

function normalize(pr: GraphQlPullRequest): GhPr {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    repo: pr.repository.nameWithOwner,
    author: pr.author?.login ?? "unknown",
    updatedAt: pr.updatedAt,
    isDraft: pr.isDraft,
    ci: ciState(pr.statusCheckRollup?.state),
    review: reviewState(pr.reviewDecision),
  };
}

function fetchPrs(search: string): GhPr[] {
  const result = Bun.spawnSync(
    ["gh", "api", "graphql", "-f", `query=${graphqlQuery}`, "-f", `search=${search}`],
    { stdout: "pipe", stderr: "pipe" },
  );

  if (result.exitCode !== 0) {
    throw new Error(decode(result.stderr));
  }

  let response: GraphQlResponse;
  try {
    response = JSON.parse(decode(result.stdout)) as GraphQlResponse;
  } catch {
    throw new Error("gh returned invalid JSON\n");
  }

  if (response.errors?.length) {
    throw new Error(`${response.errors.map((error) => error.message ?? "GraphQL error").join("; ")}\n`);
  }

  return (response.data?.search?.nodes ?? []).map(normalize);
}

try {
  const feed = mapPrsToFeed(
    {
      review: fetchPrs(searches.review),
      mine: fetchPrs(searches.mine),
      assigned: fetchPrs(searches.assigned),
    },
    Date.now(),
  );

  console.log(JSON.stringify(feed));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
