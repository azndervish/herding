import logo from './logo.svg';
import './App.css';
import Herding28 from './herding28.js'
function App() {
  const gamestate = {
  boardSize: 24,
  turn: 3,
  phase: "come_by",
  escapedCount: 1,
  dog:  { id: "dog",  type: "dog",  x: 10, y: 14, radius: 0.75 },
  herd: { id: "herd", type: "herd", x: 6,  y: 6,  radius: 2.5  },
  looseAnimals: [
    { id: "loose_1", type: "loose", x: 14, y: 8,  radius: 0.75 },
    { id: "loose_2", type: "loose", x: 9,  y: 16, radius: 0.75 },
  ],
  pen: { id: "pen", type: "pen", x: 20, y: 20, radius: 2.5 },
  events: [
    "Turn 1 — Dumb Animals: Herd wanders 4\" (angle 312°).",
    "Turn 1 — Loose Animal: Dog is 5.83\" from herd. Rolled D8: 7. An animal got spooked! loose_1 placed 3\" from herd.",
    "Turn 2 — Move Herd: Herd moved 3.20\" away from dog.",
    "Turn 2 — loose_2 fled near board edge!",
    "Turn 3 — Come-by: Dog moves to (10.00, 14.00).",
  ],
};
  const WALK_UP = {
    boardSize: 24,
    dog:  { x: 1, y: 22, radius:.75 },
    herd: { x: 6, y: 10, radius: 2.5 },
    pen:  { x: 18, y: 10, radius: 4 },
    looseAnimals: [],
    events: [],
  }
  return (
    <div className="App">
      <Herding28 state={gamestate}/>
    </div>
  );
}

export default App;
