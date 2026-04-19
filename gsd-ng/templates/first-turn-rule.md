<first_turn_rule>
On your FIRST response after this command loads, do NOT call {{USER_QUESTION_TOOL}} — it must wait until turn two (after a user reply creates a turn boundary) to render reliably. Other tool work (Read, Bash, Agent, etc.) IS fine on turn one, but keep user-visible text to a brief plain-text status (e.g., "Loading context..."). Detailed planning or execution prose must wait until after the turn boundary. {{USER_QUESTION_TOOL}} works normally on subsequent turns.
</first_turn_rule>
