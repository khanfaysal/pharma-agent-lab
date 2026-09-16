/**
 * Full-bleed shell for the lab surface.
 *
 * The directory pages are reading surfaces and cap themselves at a comfortable
 * measure. These are not: a four-arm comparison, a run table with ten numeric
 * columns and a step trace all want every pixel available, and a centred
 * max-w-7xl column makes them scroll horizontally on the machines where they
 * are actually used.
 *
 * The pages themselves carry no container -- without this they were rendering
 * flush against the viewport edge, because the root <main> stopped supplying
 * padding when the three surfaces were split apart.
 */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  return <div className="w-full px-6 py-8 2xl:px-10">{children}</div>;
}
