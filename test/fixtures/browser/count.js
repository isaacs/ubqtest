// A module for a page. The count changes 50 ms after a click.
export const count = button => {
  button.onclick = () => setTimeout(() => (button.textContent = String(Number(button.textContent) + 1)), 50)
}
