import { useGameStore } from './stores/gameStore';
import { Home } from './components/Home';
import { Room } from './components/Room';
import { Game } from './components/Game';

function App() {
  const { currentView } = useGameStore();

  return (
    <div className="min-h-dvh flex flex-col">
      {currentView === 'home' && <Home />}
      {currentView === 'room' && <Room />}
      {currentView === 'game' && <Game />}
    </div>
  );
}

export default App;
