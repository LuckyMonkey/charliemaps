export function FullscreenButton() {
  const onClick = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  };

  return <button onClick={() => void onClick()}>Fullscreen</button>;
}
