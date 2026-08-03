# Talvext architecture

One page. The narrative that explains why it is shaped this way is in
[WRITEUP.md](WRITEUP.md); the rulings behind each choice are in
[DECISIONS.md](DECISIONS.md).

```mermaid
flowchart LR
    User["Signed in user"]
    Visitor["Anonymous visitor"]
    Clerk["Clerk<br/>sessions, organizations, roles"]

    subgraph App["Talvext, one Next.js app on Vercel"]
        Screens["Server components<br/>and server actions"]
        Hook["/api/webhooks/clerk<br/>signature verified"]
        Status["/status/:slug<br/>public, cached, limited in the proxy"]
        Sweep["/api/cron/check-monitors<br/>bearer token, fails closed"]
        Beat["/api/ops/heartbeat<br/>public: 200 fresh, 503 stale"]
    end

    subgraph DB["Postgres, row level security is the tenant boundary"]
        Tenant[("Tenant tables<br/>monitors, incidents, tickets,<br/>documents, inventory, audit log")]
        Vault[("org_api_keys<br/>ciphertext only; encrypted_key<br/>withheld from every session")]
        Pulse[("platform_heartbeat<br/>one row, belongs to no tenant")]
    end

    Scheduler["cron-job.org<br/>every 5 minutes"]
    Watcher["GitHub Actions<br/>every 30 minutes, outside the deployment"]
    Targets["The URLs each org asked us to watch"]
    Providers["Anthropic, OpenAI, Google"]
    Channels["Resend email, Discord webhooks"]

    User --> Clerk
    Clerk -- "session token, forwarded<br/>as the database access token" --> Screens
    User --> Screens
    Visitor --> Status

    Clerk -. "orgs and memberships" .-> Hook
    Hook -- "service role: the only writer<br/>of tenancy itself" --> Tenant

    Screens == "as the caller: authenticated role,<br/>RLS decides every row" ==> Tenant
    Status == "as anon: column scoped grants,<br/>gated on the public flag" ==> Tenant

    Screens -- "server only, decrypted<br/>in request scope" --> Vault
    Screens -- "grounded in what the caller<br/>could already read" --> Providers

    Scheduler --> Sweep
    Sweep -- "service role" --> Tenant
    Sweep --> Pulse
    Sweep --> Targets
    Sweep --> Channels
    Watcher --> Beat
    Beat --> Pulse
```

## Reading it

**The two thick edges are the whole tenancy story.** Both cross the Postgres
boundary, and neither one trusts application code to decide what comes back.
The signed in path arrives as `authenticated` carrying the caller's own Clerk
token, so row level security resolves their organization and filters. The public
status page path arrives as `anon`, which holds no policy on anything except
rows whose organization has opted its page public, and column grants cap what
even those rows can reveal to an id, a name, and a slug.

**The dotted edge feeds the only writer of tenancy itself.** Organizations and
memberships arrive from Clerk by webhook, and that route writes on the service
role. No user session holds a verb that writes a role. That is why the role
stored in the database can be trusted as the authority over the role asserted
in the token.

**The sweep is the only thing that runs without a person.** An external
scheduler presents a bearer token every five minutes and the route fails closed
without it. The sweep checks whichever monitors are due, decides incidents,
sends alerts, and stamps the heartbeat row.

**The watcher is deliberately outside the box.** Talvext also monitors Talvext,
but those monitors are checked by the same sweep whose health is in question, so
they freeze on green when it dies. The GitHub workflow is the only thing in this
diagram that can observe the sweep's death, because it is the only thing that
does not depend on the sweep being alive.

**The vault has no edge to the browser, and that is the point.** A provider key
is encrypted before it reaches Postgres, the ciphertext column is withheld from
every signed in session's select grant, and decryption happens on the server in
request scope at the moment of a provider call.

**What the diagram leaves out**, so nobody reads it as complete: the incident
state machine that turns each check result into at most one action, the audit
log triggers that write from inside the same transaction as the change they
record, and the daily digest. All three ride the edges already drawn.
