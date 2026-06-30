import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SidebarRight } from "./SidebarRight";
import { useUIStore } from "../store/uiStore";

describe("SidebarRight", () => {
  beforeEach(() => {
    useUIStore.setState({
      agentsRefreshKey: 0,
      agentStatuses: {},
      agentBudgets: {},
      agentActivity: {},
    });
  });

  it("shows global agents as disabled when no room is selected", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 1,
          name: "Socrates",
          role_description: "Asks clarifying questions.",
          provider: "ollama",
          model: "granite3.3:2b",
          token_budget: 3,
          sort_order: 1,
        },
      ],
      headers: new Headers({ "content-type": "application/json" }),
      status: 200,
    } as Response);

    render(<SidebarRight roomId={0} />);

    expect(await screen.findByText("Socrates")).toBeInTheDocument();
    expect(
      screen.getByText(/select a chat to enable agent participation/i),
    ).toBeInTheDocument();

    const allButton = screen.getByRole("button", { name: "ALL" });
    const noneButton = screen.getByRole("button", { name: "NONE" });
    expect(allButton).toBeDisabled();
    expect(noneButton).toBeDisabled();

    const socratesCard = screen.getByText("Socrates").closest("div");
    expect(socratesCard).not.toBeNull();
    fireEvent.click(socratesCard as HTMLElement);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/agents/"),
        expect.objectContaining({ headers: expect.any(Headers) }),
      );
      expect(fetchMock).not.toHaveBeenCalledWith(
        expect.stringContaining("/api/rooms/0/agents/1/toggle"),
        expect.anything(),
      );
    });

    fetchMock.mockRestore();
  });
});
