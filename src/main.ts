// Le musée : Babylon.js, sans framework. `?moteur=babylon` (vieux liens) est simplement ignoré.
import './index.css'
import { demarrer } from './babylon/main.ts'

void demarrer(document.getElementById('root')!)
