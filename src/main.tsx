import './index.css'

const racine = document.getElementById('root')!
if (new URLSearchParams(location.search).get('moteur') === 'babylon') {
  // La tranche Babylon : un autre moteur, sans React.
  void import('./babylon/main.ts').then((m) => m.demarrer(racine))
} else {
  // React et l'app en import() : la tranche Babylon ne les télécharge pas.
  void Promise.all([import('react'), import('react-dom/client'), import('./App')]).then(([React, ReactDOM, { default: App }]) =>
    ReactDOM.createRoot(racine).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  )
}
