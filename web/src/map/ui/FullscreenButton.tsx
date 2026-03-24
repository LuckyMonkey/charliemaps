export function FullscreenButton() {
  const onClick = async () => {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  };

  return <button className="action-button" onClick={() => void onClick()} type="button">Fullscreen</button>;
}
