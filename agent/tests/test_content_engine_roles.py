from harmonia_agent.role_models import load_role_model_catalog


def test_role_catalog_uses_content_team_names():
    roles = {role.role for role in load_role_model_catalog().roles()}
    assert roles == {
        "harmonia_coordinator",
        "ryan_strategist",
        "nimi_analyst",
        "temi_editorial_planner",
        "noni_copywriter",
        "dara_editor",
        "maya_presenter",
        "nova_liaison",
    }
