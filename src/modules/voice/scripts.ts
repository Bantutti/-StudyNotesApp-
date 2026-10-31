/**
 * Reading scripts for the timestamp/accuracy spike. Read one aloud while
 * recording, then transcribe: the app compares Whisper's text to the script
 * (WER). These are SAMPLE scripts written for testing, not lecture data.
 */
export interface ReadingScript {
  id: 'en' | 'taglish' | 'ceb-mixed';
  label: string;
  /** Whisper ISO-639-1 language hint ('' = auto-detect). */
  language: '' | 'en' | 'tl';
  text: string;
}

export const READING_SCRIPTS: readonly ReadingScript[] = [
  {
    id: 'en',
    label: 'English',
    language: 'en',
    text:
      'Today we are reviewing passive transport. Diffusion is the movement of particles from an area of high concentration to an area of low concentration. Osmosis is a special case: water moves across a semi-permeable membrane toward the side with more solute. In a hypotonic solution the cell swells, in a hypertonic solution it shrinks, and in an isotonic solution there is no net movement.',
  },
  {
    id: 'taglish',
    label: 'Taglish',
    language: 'tl',
    text:
      'Okay class, today pag-uusapan natin ang diffusion at osmosis. Ang diffusion ay ang paggalaw ng particles mula sa high concentration papunta sa low concentration. Hindi kailangan ng ATP kasi passive transport ito. Sa osmosis naman, tubig lang ang gumagalaw across the membrane. Tandaan ninyo: kapag hypertonic, lalabas ang tubig; kapag hypotonic, papasok ang tubig.',
  },
  {
    id: 'ceb-mixed',
    label: 'Cebuano-mixed',
    language: '',
    text:
      'Karon nga adlaw, atong hisgutan ang osmosis. Ang tubig moagi sa semi-permeable membrane padulong sa dapit nga mas taas ang solute concentration. Kung hypertonic ang solution, mogawas ang tubig gikan sa cell ug mo-shrink kini. Kung hypotonic, mosulod ang tubig ug mo-swell ang cell. Importante ni sa exam, so i-memorize ninyo ang three solution types.',
  },
];

/** Subject glossary fed to Whisper's prompt to guide spelling (max ~224 tokens). */
export const SAMPLE_GLOSSARY =
  'Biology terms: osmosis, diffusion, semi-permeable membrane, solute, hypotonic, hypertonic, isotonic, ATP, passive transport, concentration gradient.';
