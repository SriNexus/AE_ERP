export type DocumentTheme = {
  primary: string;
  secondary: string;
  text: string;
  border: string;
  background: string;
};

export function getDocumentTheme(companyCode: string): DocumentTheme {
  // STS Theme (Amber / Gold)
  if (companyCode === 'STS') {
    return {
      primary: '#d97706',    // Amber 600
      secondary: '#fef3c7',  // Amber 50
      text: '#78350f',       // Amber 900
      border: '#fcd34d',     // Amber 300
      background: '#ffffff'
    };
  }
  
  // Default CGPL Theme (Indigo / Purple)
  return {
    primary: '#4f46e5',      // Indigo 600
    secondary: '#e0e7ff',    // Indigo 50
    text: '#312e81',         // Indigo 900
    border: '#c7d2fe',       // Indigo 200
    background: '#ffffff'
  };
}
