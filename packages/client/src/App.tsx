import { useGameStore } from './stores/gameStore';
import { Home } from './components/Home';
import { CreateRoom } from './components/CreateRoom';
import { Room } from './components/Room';
import { Game } from './components/Game';

function App() {
  const { currentView } = useGameStore();

  return (
    <div className="min-h-dvh flex flex-col">
      {currentView === 'home' && <Home />}
      {currentView === 'create' && <CreateRoom />}
      {currentView === 'room' && <Room />}
      {currentView === 'game' && <Game />}
    </div>
  );
}

export default App;
