import { AppPreview } from "./components/AppPreview.tsx";
import { Evidence } from "./components/Evidence.tsx";
import { FinalCta } from "./components/FinalCta.tsx";
import { Hero } from "./components/Hero.tsx";
import { Lifecycle } from "./components/Lifecycle.tsx";
import { Nav } from "./components/Nav.tsx";
import { Protocols } from "./components/Protocols.tsx";
import { Scope } from "./components/Scope.tsx";

export function App() {
  return (
    <>
      <Nav />
      <Hero />
      <Protocols />
      <Lifecycle />
      <Evidence />
      <AppPreview />
      <Scope />
      <FinalCta />
    </>
  );
}
