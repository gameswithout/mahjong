import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FriendsPanel, type FriendsState } from "./FriendsPanel";
import { PartyPanel, type PartyState } from "./PartyPanel";

const noop = vi.fn();

const handlers = {
  onAdd: noop,
  onAccept: noop,
  onReject: noop,
  onCancel: noop,
  onUnfriend: noop,
  onRetry: noop,
};

const partyHandlers = {
  onCreate: noop,
  onLeave: noop,
  onJoinByCode: noop,
  onGenerateCode: noop,
  onKick: noop,
  onRetry: noop,
};

describe("FriendsPanel", () => {
  it("shows presence as text, not colour alone", () => {
    const state: FriendsState = {
      status: "ready",
      friends: [
        { userId: "alice-1234567890", presence: "online" },
        { userId: "bob-1234567890", presence: "busy" },
        { userId: "carol-1234567890", presence: "offline" },
      ],
      incoming: [],
      outgoing: [],
    };
    const markup = renderToStaticMarkup(<FriendsPanel state={state} {...handlers} />);

    expect(markup).toContain("Online");
    expect(markup).toContain("In a match");
    expect(markup).toContain("Offline");
  });

  it("surfaces incoming requests with their count", () => {
    const state: FriendsState = {
      status: "ready",
      friends: [],
      incoming: [{ userId: "alice" }, { userId: "bob" }],
      outgoing: [{ userId: "carol" }],
    };
    const markup = renderToStaticMarkup(<FriendsPanel state={state} {...handlers} />);

    expect(markup).toContain("Friend requests (2)");
    expect(markup).toContain("Sent (1)");
    expect(markup).toContain("Accept");
    expect(markup).toContain("Decline");
  });

  it("offers no search surface, only add-by-id", () => {
    const state: FriendsState = { status: "ready", friends: [], incoming: [], outgoing: [] };
    const markup = renderToStaticMarkup(
      <FriendsPanel state={state} ownUserId="me-123" {...handlers} />,
    );

    // §10.6's rate limits exist because unsolicited requests are the abuse
    // vector; a search box over every account is exactly that surface.
    expect(markup).toContain("Add a friend by player ID");
    expect(markup).not.toMatch(/search/i);
    // The player needs their own ID to hand out, or nobody can add them.
    expect(markup).toContain("me-123");
  });

  it("disables party invites for offline friends and a full party", () => {
    const state: FriendsState = {
      status: "ready",
      friends: [{ userId: "alice", presence: "offline" }],
      incoming: [],
      outgoing: [],
    };
    const offline = renderToStaticMarkup(
      <FriendsPanel state={state} {...handlers} onInviteToParty={noop} canInviteToParty />,
    );
    expect(offline).toContain("They are offline");

    const online: FriendsState = {
      status: "ready",
      friends: [{ userId: "alice", presence: "online" }],
      incoming: [],
      outgoing: [],
    };
    const full = renderToStaticMarkup(
      <FriendsPanel
        state={online}
        {...handlers}
        onInviteToParty={noop}
        canInviteToParty={false}
      />,
    );
    expect(full).toContain("Your party is full");
  });
});

describe("PartyPanel", () => {
  it("explains what a party is for before one exists", () => {
    const markup = renderToStaticMarkup(
      <PartyPanel state={{ status: "none" }} {...partyHandlers} />,
    );

    expect(markup).toContain("seated at the same table");
    expect(markup).toContain("Start a party");
    expect(markup).toContain("invite code");
  });

  it("counts held seats including an unanswered invite", () => {
    const state: PartyState = {
      status: "ready",
      party: {
        partyId: "p1",
        leaderId: "alice",
        members: [
          { userId: "alice", status: "CONNECTED" },
          { userId: "bob", status: "INVITED" },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      <PartyPanel state={state} ownUserId="alice" {...partyHandlers} />,
    );

    // An outstanding invite holds a seat, so the count must include it or the
    // panel contradicts what matchmaking will do.
    expect(markup).toContain("2 of 4 seats taken");
    expect(markup).toContain("Invited");
    expect(markup).toContain("Leader");
    expect(markup).toContain("You");
  });

  it("only offers kick to the leader", () => {
    const asMember: PartyState = {
      status: "ready",
      party: {
        partyId: "p1",
        leaderId: "alice",
        members: [
          { userId: "alice", status: "CONNECTED" },
          { userId: "bob", status: "CONNECTED" },
        ],
      },
    };
    const memberView = renderToStaticMarkup(
      <PartyPanel state={asMember} ownUserId="bob" {...partyHandlers} />,
    );
    expect(memberView).not.toContain("Remove");

    const leaderView = renderToStaticMarkup(
      <PartyPanel state={asMember} ownUserId="alice" {...partyHandlers} />,
    );
    expect(leaderView).toContain("Remove");
  });

  it("hides departed members rather than listing them as present", () => {
    const state: PartyState = {
      status: "ready",
      party: {
        partyId: "p1",
        leaderId: "alice",
        members: [
          { userId: "alice", status: "CONNECTED" },
          { userId: "ghost", status: "LEFT" },
        ],
      },
    };
    const markup = renderToStaticMarkup(
      <PartyPanel state={state} ownUserId="alice" {...partyHandlers} />,
    );
    expect(markup).not.toContain("ghost");
    expect(markup).toContain("1 of 4 seats taken");
  });
});
