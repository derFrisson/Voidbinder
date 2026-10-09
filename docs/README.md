# Documentation

| Folder                             | What goes there                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| [adr](adr)                         | Architecture decision records. A change to an accepted decision needs a new ADR. |
| [guides](guides)                   | Runbooks and how-tos, such as the [database VPS](guides/database-vps.md).        |
| [environments.md](environments.md) | Environments, config, secrets and deploy commands.                               |
| [site](site)                       | Promo site docs: design, SEO, accessibility, legal, waitlist.                    |
| [marketing](marketing)             | Research on competitors and card imagery rights.                                 |
| [sprints](sprints)                 | Sprint plans and results.                                                        |
| [agents](agents)                   | Briefing rules and prompts for AI agents working on tickets.                     |

## Where a new document goes

- A decision with consequences for the architecture: `adr/NNNN-title.md`, using the template in
  [adr/README.md](adr/README.md).
- Steps someone follows to set up or operate something: `guides/`.
- How one app works: that app's own `README.md`. Design and product docs for the site: `site/`.
- Research with sources, such as legal or competitor notes: `marketing/`.
- Contributor rules belong in [CONTRIBUTING.md](../CONTRIBUTING.md), not here.

Name files in lowercase with dashes. Start with what the document is for. Link to the code instead
of copying it.
